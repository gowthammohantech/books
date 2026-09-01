/**
 * Postgres/Prisma seed for the custom-field `FieldType` catalog.
 *
 * The Add/Edit Custom Field form (Settings > Module Settings > Custom Fields)
 * populates its "field type" dropdown from `/admin/field-types`. Without seeded
 * rows the form has nothing to select. Option-based types MUST use the slugs the
 * frontend recognises for the "options" editor: `dropdown`, `radio`, `check_box`.
 * Idempotent (slug is @unique → upsert).
 *
 * Slugs MUST match what the renderer (DynamicCustomFields.tsx) special-cases,
 * otherwise a "Date" field silently renders as a plain text input instead of a
 * date picker. The renderer keys on: `textarea`, `number`, `dropdown`, `radio`,
 * `check_box`, `datepicker`, `file`; everything else falls through to a text
 * input. The create form (CustomFieldForm.tsx) keys options on
 * `dropdown`/`radio`/`check_box`. This set is the consistent intersection.
 *
 * Run: `npx ts-node prisma/seedFieldTypes.ts` (or via the install/seed flow).
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const FIELD_TYPES: { name: string; slug: string }[] = [
  { name: 'Text', slug: 'text' },
  { name: 'Textarea', slug: 'textarea' },
  { name: 'Number', slug: 'number' },
  { name: 'Date', slug: 'datepicker' },     // renderer date picker keys on `datepicker`
  { name: 'File', slug: 'file' },           // renderer file upload keys on `file`
  { name: 'Dropdown', slug: 'dropdown' },   // needs options (FE)
  { name: 'Radio', slug: 'radio' },         // needs options (FE)
  { name: 'Checkbox', slug: 'check_box' },  // needs options (FE)
];

export async function seedFieldTypes(): Promise<{ created: number }> {
  let created = 0;
  for (const ft of FIELD_TYPES) {
    const existing = await prisma.fieldType.findUnique({ where: { slug: ft.slug } });
    if (existing) continue;
    await prisma.fieldType.create({ data: { name: ft.name, slug: ft.slug } });
    created += 1;
  }
  return { created };
}

if (require.main === module) {
  seedFieldTypes()
    .then((r) => { console.log(`Field types seeded (created ${r.created} new).`); return prisma.$disconnect(); })
    .then(() => process.exit(0))
    .catch(async (e) => { console.error('seedFieldTypes error:', e); await prisma.$disconnect(); process.exit(1); });
}
