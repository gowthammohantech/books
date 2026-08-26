import { type Prisma, type CustomFieldValueModule } from '@prisma/client';

type Tx = Prisma.TransactionClient;

interface CustomFieldEntry {
  fieldId: string;
  value?: string;
}

interface InsertCustomFieldValuesOptions {
  module: CustomFieldValueModule;
  recordId: string;
  customFields: CustomFieldEntry[] | string | unknown;
  files: Express.Multer.File[];
  userId: string;
}

/**
 * Writes custom-field values for any module/record.
 * Mirrors the invoice flow: deletes existing rows then createMany.
 * Accepts customFields as an array or a JSON string.
 */
export async function insertCustomFieldValues(
  tx: Tx,
  { module, recordId, customFields, files, userId }: InsertCustomFieldValuesOptions,
): Promise<void> {
  let parsed: CustomFieldEntry[] = [];

  if (typeof customFields === 'string') {
    try {
      parsed = JSON.parse(customFields) as CustomFieldEntry[];
    } catch {
      throw new Error('Invalid customFields payload');
    }
  } else if (Array.isArray(customFields)) {
    parsed = customFields as CustomFieldEntry[];
  }

  // Always delete existing rows for (module, recordId) to keep values fresh
  await tx.customFieldValue.deleteMany({ where: { module, recordId } });

  if (parsed.length === 0) return;

  const records: Prisma.CustomFieldValueCreateManyInput[] = parsed.map((entry) => {
    let value: Prisma.InputJsonValue = entry.value ?? '';
    const fileMatch = files.find((f) => f.fieldname === `customField_${entry.fieldId}`);
    if (fileMatch) value = fileMatch.path;
    return {
      customFieldId: entry.fieldId,
      module,
      recordId,
      value,
      createdBy: userId,
    };
  });

  await tx.customFieldValue.createMany({ data: records });
}

interface ReadCustomFieldValuesOptions {
  module: CustomFieldValueModule;
  recordId: string;
  moduleSlug: string;
}

/**
 * Reads custom-field values for any module/record, keyed by fieldSlug.
 * Mirrors the invoice read-back block: finds the module → its non-deleted
 * custom fields → their stored values → returns { [fieldSlug]: value | null }.
 */
export async function readCustomFieldValues(
  prisma: Prisma.TransactionClient,
  { module, recordId, moduleSlug }: ReadCustomFieldValuesOptions,
): Promise<Record<string, Prisma.JsonValue | null>> {
  const mod = await prisma.module.findFirst({ where: { moduleSlug } });
  if (!mod) return {};

  const fields = await prisma.customField.findMany({
    where: { moduleId: mod.id, deletedAt: null },
    select: { id: true, fieldSlug: true },
  });

  const customValues = await prisma.customFieldValue.findMany({
    where: { module, recordId },
  });

  const customValueMap: Record<string, Prisma.JsonValue> = {};
  customValues.forEach((v) => {
    customValueMap[v.customFieldId] = v.value;
  });

  const result: Record<string, Prisma.JsonValue | null> = {};
  fields.forEach((field) => {
    result[field.fieldSlug] = customValueMap[field.id] ?? null;
  });

  return result;
}

interface ReadCustomFieldValuesForRecordsOptions {
  module: CustomFieldValueModule;
  recordIds: string[];
  moduleSlug: string;
}

/**
 * Batched variant of readCustomFieldValues for list endpoints (no N+1):
 * returns { [recordId]: { [fieldSlug]: value | null } } for every requested id.
 */
export async function readCustomFieldValuesForRecords(
  prisma: Prisma.TransactionClient,
  { module, recordIds, moduleSlug }: ReadCustomFieldValuesForRecordsOptions,
): Promise<Record<string, Record<string, Prisma.JsonValue | null>>> {
  if (recordIds.length === 0) return {};
  const mod = await prisma.module.findFirst({ where: { moduleSlug } });
  if (!mod) return {};

  const fields = await prisma.customField.findMany({
    where: { moduleId: mod.id, deletedAt: null },
    select: { id: true, fieldSlug: true },
  });
  if (fields.length === 0) return {};

  const values = await prisma.customFieldValue.findMany({
    where: {
      module,
      recordId: { in: recordIds },
      customFieldId: { in: fields.map((f) => f.id) },
    },
  });
  const byRecordAndField = new Map<string, Prisma.JsonValue>();
  values.forEach((v) => byRecordAndField.set(`${v.recordId}:${v.customFieldId}`, v.value as Prisma.JsonValue));

  const result: Record<string, Record<string, Prisma.JsonValue | null>> = {};
  recordIds.forEach((recordId) => {
    const perField: Record<string, Prisma.JsonValue | null> = {};
    fields.forEach((f) => {
      perField[f.fieldSlug] = byRecordAndField.get(`${recordId}:${f.id}`) ?? null;
    });
    result[recordId] = perField;
  });
  return result;
}
