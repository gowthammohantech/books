import fs from 'fs';
import path from 'path';

import type { Request, Response } from 'express';
import { Prisma } from '@prisma/client';
import type { CompanySettings, Permission, Module, GeneralSetting } from '@prisma/client';

import { prisma } from '../lib/prisma';
import { requireActingUserId, requireUserId, UnauthorizedError } from '../lib/tenantScope';
import { applyPack, type ApplyPackTx } from '../lib/ledger/applyPack';
import { resolvePackCode } from '../lib/ledger/resolvePackCode';
import { seedTransactionCategoriesForUser } from '../prisma/seedTransactionCategories';
import { ensureDefaultTaxGroup } from '../lib/tax/ensureDefaultTaxGroup';
import { parseVatNumber } from '../lib/euVat';

/**
 * Structural validation for the tenant tax identifiers. Empty/null/undefined are
 * always allowed (these columns are nullable). Returns an error message string
 * for the first malformed identifier, or null when everything is acceptable.
 *
 *  - vatNumber: EU/UK VAT, structurally validated via parseVatNumber.
 *  - abn:       Australian Business Number — 11 digits (spaces tolerated).
 *  - nzGstNumber: NZ GST/IRD number — 8 or 9 digits (spaces/hyphens tolerated).
 *
 * gstin is left to existing validation paths (India) and only persisted here.
 */
function validateTaxIdentifiers(updates: Record<string, unknown>): string | null {
  const vatRaw = updates.vatNumber;
  if (typeof vatRaw === 'string' && vatRaw.trim() !== '') {
    if (!parseVatNumber(vatRaw).valid) {
      return 'Invalid VAT number format.';
    }
  }

  const abnRaw = updates.abn;
  if (typeof abnRaw === 'string' && abnRaw.trim() !== '') {
    const digits = abnRaw.replace(/[\s-]/g, '');
    if (!/^[0-9]{11}$/.test(digits)) {
      return 'Invalid ABN format (expected 11 digits).';
    }
  }

  const nzRaw = updates.nzGstNumber;
  if (typeof nzRaw === 'string' && nzRaw.trim() !== '') {
    const digits = nzRaw.replace(/[\s-]/g, '');
    if (!/^[0-9]{8,9}$/.test(digits)) {
      return 'Invalid NZ GST number format (expected 8-9 digits).';
    }
  }

  return null;
}

function handleUnauthorized(res: Response, err: unknown): boolean {
  if (err instanceof UnauthorizedError) {
    res.status(err.status).json({ success: false, message: err.message });
    return true;
  }
  return false;
}

function deleteOldFile(filePath: string | null | undefined): void {
  if (!filePath) return;
  try {
    const fullPath = path.join(__dirname, '..', filePath);
    if (fs.existsSync(fullPath)) {
      fs.unlinkSync(fullPath);
    }
  } catch (err) {
    console.error('Error deleting old file:', err);
  }
}

function buildBaseUrl(req: Request): string {
  return `${req.protocol}://${req.get('host')}`;
}

const IMAGE_FIELDS = ['siteLogo', 'favicon', 'companyLogo', 'companyBanner'] as const;
type ImageField = (typeof IMAGE_FIELDS)[number];

interface CompanySettingsResponse extends Omit<CompanySettings, never> {
  locationDetails?: {
    country: unknown;
    state: unknown;
    city: unknown;
  };
}

function decorateImageUrls(
  settings: CompanySettings,
  baseUrl: string,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...settings };
  for (const field of IMAGE_FIELDS) {
    const value = settings[field];
    if (value) {
      const cleanedPath = String(value).replace(/^[\\/]+/, '');
      out[field] = `${baseUrl}/${cleanedPath.replace(/\\/g, '/')}`;
    }
  }
  return out;
}

// =============================================================================
// General Settings (key/value store)
// =============================================================================

interface IncomingSetting {
  key?: string;
  value?: unknown;
  groupSlug?: string;
}

export async function createOrUpdateGeneralSetting(req: Request, res: Response): Promise<void> {
  try {
    const userId = requireUserId(req);
    const { settings } = req.body as { settings?: IncomingSetting[] };

    if (!settings || !Array.isArray(settings) || settings.length === 0) {
      res.status(400).json({
        success: false,
        message: 'Request must include an array of settings with key, value, and optional groupSlug',
      });
      return;
    }

    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      res.status(404).json({ success: false, message: 'User not found' });
      return;
    }

    const results: Array<Record<string, unknown>> = [];

    for (const { key, value, groupSlug = 'general' } of settings) {
      if (!key || value === undefined) {
        results.push({
          key,
          status: 'failed',
          message: 'Key and value are required',
        });
        continue;
      }

      const existing = await prisma.generalSetting.findUnique({ where: { key } });

      if (existing) {
        await prisma.generalSetting.update({
          where: { key },
          data: {
            value: value as Prisma.InputJsonValue,
            groupSlug,
            updatedBy: user.id,
          },
        });

        results.push({
          key,
          value,
          groupSlug,
          status: 'updated',
          message: 'Setting updated successfully',
        });
      } else {
        await prisma.generalSetting.create({
          data: {
            key,
            value: value as Prisma.InputJsonValue,
            groupSlug,
            createdBy: user.id,
            updatedBy: user.id,
          },
        });

        results.push({
          key,
          value,
          groupSlug,
          status: 'created',
          message: 'Setting created successfully',
        });
      }
    }

    res.status(200).json({
      success: true,
      message: 'General settings processed successfully',
      data: results,
    });
  } catch (err) {
    if (handleUnauthorized(res, err)) return;
    console.error('Error creating/updating general settings:', err);
    res.status(500).json({
      success: false,
      message: 'Error creating/updating general settings',
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

export async function listGeneralSettings(req: Request, res: Response): Promise<void> {
  try {
    const { groupSlug } = req.query as { groupSlug?: string };

    const where: Prisma.GeneralSettingWhereInput = {};
    if (groupSlug) where.groupSlug = groupSlug;

    const settings = await prisma.generalSetting.findMany({
      where,
      include: {
        createdByUser: { select: { id: true, firstName: true, lastName: true, email: true } },
        updatedByUser: { select: { id: true, firstName: true, lastName: true, email: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    res.status(200).json({
      success: true,
      data: settings,
    });
  } catch (err) {
    console.error('Error fetching general settings:', err);
    res.status(500).json({
      success: false,
      message: 'Error fetching general settings',
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

// =============================================================================
// Company Settings (per-user; userId is unique on the schema)
// =============================================================================

export async function getCompanySettings(req: Request, res: Response): Promise<void> {
  try {
    const userId = requireUserId(req);

    const settings = await prisma.companySettings.findUnique({
      where: { userId },
    });

    if (!settings) {
      res.status(404).json({
        success: false,
        message: 'Company settings not found',
        data: null,
      });
      return;
    }

    const baseUrl = buildBaseUrl(req);
    const settingsData = decorateImageUrls(settings, baseUrl) as unknown as CompanySettingsResponse;

    // Resolve referenced country/state/city by id (stored as plain strings in
    // schema; original Mongoose populated by ObjectId).
    const [country, state, city] = await Promise.all([
      settings.country
        ? prisma.country.findUnique({
            where: { id: settings.country },
            select: { id: true, name: true, iso3: true, iso2: true, phonecode: true, currency: true },
          })
        : Promise.resolve(null),
      settings.state
        ? prisma.state.findUnique({
            where: { id: settings.state },
            select: { id: true, name: true, state_code: true },
          })
        : Promise.resolve(null),
      settings.city
        ? prisma.city.findUnique({
            where: { id: settings.city },
            select: { id: true, name: true },
          })
        : Promise.resolve(null),
    ]);

    settingsData.locationDetails = {
      country: country
        ? {
            id: country.id,
            name: country.name,
            iso3: country.iso3,
            iso2: country.iso2,
            phonecode: country.phonecode,
            currency: country.currency,
          }
        : null,
      state: state
        ? {
            id: state.id,
            name: state.name,
            code: state.state_code,
          }
        : null,
      city: city
        ? {
            id: city.id,
            name: city.name,
          }
        : null,
    };

    res.status(200).json({
      success: true,
      data: settingsData,
    });
  } catch (err) {
    if (handleUnauthorized(res, err)) return;
    console.error('Get company settings error:', err);
    res.status(500).json({
      success: false,
      message: 'Error fetching company settings',
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

/**
 * Best-effort tenant ledger onboarding, shared by the company-settings save
 * (`updateCompanySettings`) and the initial setup wizard (`updateCompanySetup`).
 *
 * When the owner has zero ledger account mappings it applies the country pack
 * (chart of accounts + role mappings + regime + default tax rates) for the
 * tenant's country, then seeds the Money In/Out transaction categories and
 * ensures a default "No Tax" tax group exists so Products can be created.
 *
 * Fully idempotent and NON-FATAL: any failure is logged and swallowed so it can
 * never block the caller's primary save. Resolution prefers the saved 2-letter
 * `countryCode`; otherwise it maps the `countryId` FK to its ISO-2. EU members
 * route to the generic 'EU' pack while the real member ISO-2 is preserved so the
 * VAT rate + reverse-charge resolve correctly.
 */
async function autoInitLedgerForUser(userId: string): Promise<void> {
  try {
    const mappings = await prisma.ledgerAccountMapping.count({ where: { userId } });
    if (mappings === 0) {
      const settings = await prisma.companySettings.findUnique({
        where: { userId },
        select: { countryCode: true, countryId: true, ledgerInitialized: true },
      });

      const savedCountryCode = settings?.countryCode ?? null;
      let memberIso2: string | null =
        savedCountryCode && /^[A-Z]{2}$/i.test(savedCountryCode) && savedCountryCode.toUpperCase() !== 'EU'
          ? savedCountryCode.toUpperCase()
          : null;
      if (!memberIso2 && settings?.countryId) {
        memberIso2 =
          (await prisma.country.findUnique({
            where: { id: settings.countryId },
            select: { iso2: true },
          }))?.iso2?.toUpperCase() ?? null;
      }
      const packCode = resolvePackCode(memberIso2);

      // Detect partial init: ledgerInitialized=true but zero mappings (broken state).
      const wasInitialized = settings?.ledgerInitialized === true;

      await prisma.$transaction(async (tx) => {
        if (wasInitialized) {
          // Temporarily clear the flag so applyPack's guard does not throw.
          await tx.companySettings.update({
            where: { userId },
            data: { ledgerInitialized: false },
          });
        }

        await applyPack(tx as unknown as ApplyPackTx, {
          userId,
          countryCode: packCode,
          memberCountryCode: memberIso2,
          goLiveDate: new Date(),
        });

        if (wasInitialized) {
          // Restore the flag after applyPack succeeds.
          await tx.companySettings.update({
            where: { userId },
            data: { ledgerInitialized: true },
          });
        }
      });

      console.log(`[ledger auto-init] initialized pack ${packCode} for user ${userId}`);
    }

    // Seed the Money In/Out transaction-category catalog now that role mappings
    // exist — so banking explain/reconcile dropdowns are populated immediately.
    // Idempotent on (userId, code); no-op if the ledger isn't fully set up.
    const catResult = await seedTransactionCategoriesForUser(userId);
    if (catResult.created || catResult.migrated) {
      console.log(
        `[onboarding] seeded transaction categories for user ${userId} ` +
        `(created ${catResult.created}, migrated ${catResult.migrated})`,
      );
    }

    // Ensure a default "No Tax" TaxGroup/TaxRate exists so this tenant can
    // create Products right away (Product.taxGroupId is optional, but this
    // gives new tenants a sensible default out of the box). Idempotent.
    const taxResult = await ensureDefaultTaxGroup(userId);
    if (taxResult.created) {
      console.log(`[onboarding] ensured default tax group for user ${userId}`);
    }
  } catch (ledgerErr) {
    console.warn('ledger auto-init skipped (non-fatal):', ledgerErr);
  }
}

export async function updateCompanySettings(req: Request, res: Response): Promise<void> {
  try {
    const userId = requireUserId(req);
    const updates: Record<string, unknown> = { ...(req.body as Record<string, unknown>) };

    const currentSettings = await prisma.companySettings.findUnique({
      where: { userId },
    });

    const files = req.files as
      | Record<string, Express.Multer.File[] | undefined>
      | undefined;

    if (files) {
      for (const field of IMAGE_FIELDS) {
        const uploaded = files[field];
        if (uploaded && uploaded[0]) {
          if (currentSettings && currentSettings[field]) {
            deleteOldFile(currentSettings[field]);
          }
          updates[field] = `/uploads/company/${uploaded[0].filename}`;
        }
      }
    }

    // Whitelist: only pass fields that are actual columns on CompanySettings.
    // The frontend sends extras like locationDetails (object), siteLogo_preview_url
    // (base64), and other UI state. We strip them rather than passing through.
    const ALLOWED_FIELDS = new Set([
      'companyName',
      'email',
      'phone',
      'address',
      'city',
      'state',
      'country',
      'pincode',
      'siteLogo',
      'favicon',
      'companyLogo',
      'companyBanner',
      'fax',
      'taxRegime',
      'countryId',
      'stateId',
      'publicBaseUrl',
      'merchantUpiId',
      'merchantName',
      // Tax identifiers (nullable; per-country).
      'gstin',
      'vatNumber',
      'abn',
      'nzGstNumber',
      // OPTIONAL online EU VIES VAT validation — per-tenant opt-in (off by default).
      'viesValidationEnabled',
      // Bank AUTO-POST tier — per-tenant opt-in (off by default). When on, near-
      // certain bank matches post straight to the GL, skipping the approval queue.
      'bankAutoPostEnabled',
      // Invoice item-picker display toggles — per-tenant, control which extra
      // columns/affordances show in the invoice line-item product picker.
      'itemPickerShowRate',
      'itemPickerShowStock',
      'itemPickerShowImage',
    ]);
    for (const key of Object.keys(updates)) {
      if (!ALLOWED_FIELDS.has(key)) {
        delete updates[key];
      }
    }

    // Coerce the VIES toggle to a strict boolean (frontend may send 'true'/'false'
    // strings via multipart form data).
    if ('viesValidationEnabled' in updates) {
      const v = updates.viesValidationEnabled;
      updates.viesValidationEnabled = v === true || v === 'true' || v === '1' || v === 1;
    }

    // Coerce the bank auto-post toggle to a strict boolean (multipart form data may
    // send 'true'/'false' strings). Default OFF is enforced by the schema.
    if ('bankAutoPostEnabled' in updates) {
      const v = updates.bankAutoPostEnabled;
      updates.bankAutoPostEnabled = v === true || v === 'true' || v === '1' || v === 1;
    }

    // Coerce the item-picker display toggles to strict booleans (multipart form
    // data may send 'true'/'false' strings).
    if ('itemPickerShowRate' in updates) {
      const v = updates.itemPickerShowRate;
      updates.itemPickerShowRate = v === true || v === 'true' || v === '1' || v === 1;
    }
    if ('itemPickerShowStock' in updates) {
      const v = updates.itemPickerShowStock;
      updates.itemPickerShowStock = v === true || v === 'true' || v === '1' || v === 1;
    }
    if ('itemPickerShowImage' in updates) {
      const v = updates.itemPickerShowImage;
      updates.itemPickerShowImage = v === true || v === 'true' || v === '1' || v === 1;
    }

    // Validate tax identifier formats (after whitelist, before persist).
    const taxError = validateTaxIdentifiers(updates);
    if (taxError) {
      res.status(400).json({ success: false, message: taxError });
      return;
    }

    // Validate country/state FK references before persisting — CompanySettings.
    // countryId/stateId are real FKs (Country/State tables). Without this check,
    // an id that doesn't exist (e.g. geo dataset never imported on a fresh
    // self-hosted install) throws an uncaught Prisma FK-violation and the
    // client gets a raw 500. Fail fast with a clear 400 instead, for both the
    // create and update paths of the upsert below.
    if (updates.countryId) {
      const countryRow = await prisma.country.findUnique({
        where: { id: updates.countryId as string },
      });
      if (!countryRow) {
        res.status(400).json({
          success: false,
          message: 'Selected country was not found — please re-select it from the list.',
        });
        return;
      }
    }
    if (updates.stateId) {
      const stateRow = await prisma.state.findUnique({
        where: { id: updates.stateId as string },
      });
      if (!stateRow) {
        res.status(400).json({
          success: false,
          message: 'Selected state was not found — please re-select it from the list.',
        });
        return;
      }
    }

    const data = updates as Prisma.CompanySettingsUncheckedUpdateInput &
      Prisma.CompanySettingsUncheckedCreateInput;

    const settings = await prisma.companySettings.upsert({
      where: { userId },
      update: data,
      create: {
        userId,
        companyName: (data.companyName as string) ?? '',
        email: (data.email as string) ?? '',
        phone: (data.phone as string) ?? '',
        address: (data.address as string) ?? '',
        city: (data.city as string) ?? '',
        state: (data.state as string) ?? '',
        country: (data.country as string) ?? '',
        pincode: (data.pincode as string) ?? '',
        siteLogo: (data.siteLogo as string | undefined) ?? '',
        favicon: (data.favicon as string | undefined) ?? '',
        companyLogo: (data.companyLogo as string | undefined) ?? '',
        companyBanner: (data.companyBanner as string | undefined) ?? '',
        fax: (data.fax as string | undefined) ?? null,
      },
    });

    const baseUrl = buildBaseUrl(req);
    const settingsData = decorateImageUrls(settings, baseUrl);

    // Best-effort ledger onboarding (apply country pack + seed tx categories +
    // default tax group). Shared with the setup wizard; idempotent + non-fatal.
    await autoInitLedgerForUser(userId);

    res.status(200).json({
      success: true,
      message: 'Company settings updated successfully',
      data: settingsData,
    });
  } catch (err) {
    if (handleUnauthorized(res, err)) return;
    console.error('Update company settings error:', err);

    const files = req.files as
      | Record<string, Express.Multer.File[] | undefined>
      | undefined;
    if (files) {
      for (const fileType of Object.keys(files)) {
        const arr = files[fileType];
        if (arr && arr[0]) {
          const filePath = path.join(
            __dirname,
            '../uploads/company',
            arr[0].filename,
          );
          if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
          }
        }
      }
    }

    // Defense-in-depth: any FK-constraint violation that wasn't proactively
    // caught above (e.g. a race, or a future FK added elsewhere) should still
    // degrade gracefully instead of leaking a raw Prisma error string.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2003') {
      res.status(400).json({
        success: false,
        message:
          'One of the selected reference values (country/state) is invalid. Please re-select and try again.',
      });
      return;
    }

    res.status(500).json({
      success: false,
      message: 'Error updating company settings',
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

// =============================================================================
// Basic Details — aggregates company + locale + role + permissions + currency
// =============================================================================

interface CleanObjectInput {
  createdAt?: unknown;
  updatedAt?: unknown;
  isDeleted?: unknown;
  __v?: unknown;
  [k: string]: unknown;
}

function cleanObject<T extends CleanObjectInput | null | undefined>(
  obj: T,
): Omit<NonNullable<T>, 'createdAt' | 'updatedAt' | 'isDeleted' | '__v'> | T {
  if (!obj) return obj;
  const {
    createdAt: _ca,
    updatedAt: _ua,
    isDeleted: _id,
    __v: _v,
    ...rest
  } = obj as CleanObjectInput;
  void _ca;
  void _ua;
  void _id;
  void _v;
  return rest as Omit<NonNullable<T>, 'createdAt' | 'updatedAt' | 'isDeleted' | '__v'>;
}

export async function getBasicDetails(req: Request, res: Response): Promise<void> {
  try {
    const userIdParam = (req.query.userId as string | undefined) ?? undefined;
    // Tenant (company-owner) id — scopes shared company data (company settings,
    // localization, invoice template) so every member of a workspace sees the
    // same company configuration.
    let userId: string | undefined;
    try {
      userId = requireUserId(req);
    } catch {
      userId = undefined;
    }
    userId = userId ?? userIdParam;

    // Acting (logged-in) user id — resolves THIS user's own identity, role and
    // permissions. Must NOT use the tenant id here: requireUserId returns the
    // company-owner id, so using it would make every non-owner user inherit the
    // owner's role/permissions (often empty) and get locked out of the app.
    let actingUserId: string | undefined;
    try {
      actingUserId = requireActingUserId(req);
    } catch {
      actingUserId = undefined;
    }
    actingUserId = actingUserId ?? userIdParam ?? userId;

    if (!userId || !actingUserId) {
      res.status(400).json({ message: 'User ID is required' });
      return;
    }

    const baseUrl = buildBaseUrl(req);

    const user = await prisma.user.findUnique({ where: { id: actingUserId } });
    if (!user) {
      res.status(404).json({
        success: false,
        message: 'User not found',
      });
      return;
    }

    let role: {
      id: string;
      roleName: string;
      status: boolean;
      deletedAt: Date | null;
      defaultRoute: string | null;
    } | null = null;
    let permissions: Array<Permission & { module: Module | null }> = [];

    if (user.roleId) {
      const fetchedRole = await prisma.role.findUnique({ where: { id: user.roleId } });
      if (fetchedRole && !fetchedRole.deletedAt) {
        role = {
          id: fetchedRole.id,
          roleName: fetchedRole.roleName,
          status: fetchedRole.status,
          deletedAt: fetchedRole.deletedAt,
          defaultRoute:
            (fetchedRole as unknown as { defaultRoute?: string | null }).defaultRoute ??
            'dashboard',
        };
        permissions = await prisma.permission.findMany({
          where: { roleId: fetchedRole.id, deletedAt: null },
          include: { module: true },
        });
      }
    }

    const [
      defaultCurrency,
      companySettings,
      userLocalization,
      defaultDateFormat,
      defaultTimeFormat,
      defaultTimezone,
      invoiceTemplate,
      invoicePrefixSetting,
      invoiceNumberTypeSetting,
    ] = await Promise.all([
      prisma.currency.findFirst({
        where: { isDeleted: false, isDefault: true },
      }),
      prisma.companySettings.findUnique({ where: { userId } }),
      prisma.localization.findFirst({
        where: { isActive: true, userId },
        include: { dateFormat: true, timeFormat: true, timezone: true },
        orderBy: { createdAt: 'desc' },
      }),
      prisma.dateFormat.findFirst({
        where: { isDeleted: false, isActive: true },
        orderBy: { createdAt: 'asc' },
      }),
      prisma.timeFormat.findFirst({
        where: { isDeleted: false, isActive: true },
        orderBy: { createdAt: 'asc' },
      }),
      prisma.timezone.findFirst({
        orderBy: { createdAt: 'asc' },
      }),
      prisma.invoiceTemplate.findFirst({
        where: { userId },
        orderBy: { createdAt: 'desc' },
      }),
      prisma.generalSetting.findUnique({ where: { key: 'invoicePrefix' } }),
      prisma.generalSetting.findUnique({ where: { key: 'invoiceNumberType' } }),
    ]);

    const defaultValues = {
      currency: {
        _id: null,
        name: 'Default Currency',
        code: 'USD',
        symbol: '$',
        status: true,
        isDefault: true,
        createdBy: null,
      },
      company: {
        _id: null,
        companyLogo: '',
        companyName: 'Default Company',
        favicon: '',
        siteLogo: '',
        email: 'contact@default.com',
        phone: '',
        city: '',
        country: '',
        fax: '',
        pincode: '',
        state: '',
        address: '',
        companyBanner: '',
      },
      dateFormat: {
        _id: null,
        title: 'DD-MM-YYYY',
        format: 'DD-MM-YYYY',
        isActive: true,
      },
      timeFormat: {
        _id: null,
        name: 'H:i:s',
        format: 'H:i:s',
        isActive: true,
      },
      timezone: {
        _id: null,
        name: 'UTC',
        utc_offset: '+00:00',
      },
      role: {
        id: null,
        roleName: 'Default Role',
        status: true,
        defaultRoute: 'dashboard',
      },
      permissions: [] as unknown[],
      invoiceTemplate: {
        _id: null,
        default_invoice_template: 'default-template',
        userId,
        createdAt: null,
        updatedAt: null,
      },
    };

    const invoicePrefix =
      invoicePrefixSetting?.value && typeof invoicePrefixSetting.value === 'string'
        ? invoicePrefixSetting.value
        : 'INV_';

    const invoiceNumberType =
      invoiceNumberTypeSetting?.value && typeof invoiceNumberTypeSetting.value === 'string'
        ? invoiceNumberTypeSetting.value
        : 'auto';

    let processedCompanySettings: Record<string, unknown> | null = null;
    if (companySettings) {
      processedCompanySettings = cleanObject(
        companySettings as unknown as CleanObjectInput,
      ) as Record<string, unknown>;
      for (const key of IMAGE_FIELDS) {
        const raw = (companySettings as unknown as Record<string, unknown>)[key];
        processedCompanySettings[key] = raw ? `${baseUrl}${raw}` : '';
      }
    }

    const responseData = {
      currency:
        cleanObject(defaultCurrency as unknown as CleanObjectInput) ?? defaultValues.currency,
      company: processedCompanySettings ?? defaultValues.company,
      dateFormat:
        cleanObject(
          (userLocalization?.dateFormat as unknown as CleanObjectInput) ??
            (defaultDateFormat as unknown as CleanObjectInput),
        ) ?? defaultValues.dateFormat,
      timeFormat:
        cleanObject(
          (userLocalization?.timeFormat as unknown as CleanObjectInput) ??
            (defaultTimeFormat as unknown as CleanObjectInput),
        ) ?? defaultValues.timeFormat,
      timezone:
        cleanObject(
          (userLocalization?.timezone as unknown as CleanObjectInput) ??
            (defaultTimezone as unknown as CleanObjectInput),
        ) ?? defaultValues.timezone,
      startWeek: userLocalization?.startWeek ?? 'Monday',
      role: role
        ? {
            id: role.id,
            roleName: role.roleName,
            status: role.status,
            defaultRoute: role.defaultRoute ?? 'dashboard',
          }
        : defaultValues.role,
      // Convenience top-level copy (same convention as startWeek/invoicePrefix
      // sitting directly on `data`) so the post-login frontend redirect logic
      // doesn't need to reach into `data.role` — mirrors role.defaultRoute above.
      defaultRoute: (role ?? defaultValues.role).defaultRoute ?? 'dashboard',
      permissions: permissions.length
        ? permissions.map((permission) => ({
            id: permission.id,
            roleId: permission.roleId?.toString() ?? null,
            moduleId: permission.module?.id?.toString() ?? null,
            moduleName: permission.module?.moduleName ?? null,
            moduleSlug: permission.module?.moduleSlug ?? null,
            moduleStatus: permission.module ? true : null,
            moduleCreatedAt: permission.module?.createdAt ?? null,
            moduleUpdatedAt: permission.module?.updatedAt ?? null,
            create: permission.create,
            edit: permission.edit,
            delete: permission.delete,
            view: permission.view,
            allowAll: permission.allowAll,
            deletedAt: permission.deletedAt,
            createdAt: permission.createdAt,
            updatedAt: permission.updatedAt,
          }))
        : defaultValues.permissions,
      invoiceTemplate:
        cleanObject(invoiceTemplate as unknown as CleanObjectInput) ??
        defaultValues.invoiceTemplate,
      invoicePrefix,
      invoiceNumberType,
    };

    res.status(200).json({
      success: true,
      message: 'Basic details fetched successfully',
      data: responseData,
    });
  } catch (err) {
    if (handleUnauthorized(res, err)) return;
    console.error('Error fetching basic details:', err);
    res.status(500).json({
      success: false,
      message: 'Server error. Please try again later.',
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

// =============================================================================
// Company Setup — onboarding-style aggregate update
// =============================================================================

export async function updateCompanySetup(req: Request, res: Response): Promise<void> {
  try {
    const userId = requireUserId(req);

    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      res.status(404).json({ success: false, message: 'User not found' });
      return;
    }

    const {
      companyName,
      address,
      country,
      state,
      city,
      pincode,
      currencyId,
      timezoneId,
      dateFormatId,
    } = req.body as Record<string, string | undefined>;

    if (!companyName || !country || !state || !city) {
      res.status(400).json({
        success: false,
        message: 'Company Name, Country, State, and City are required.',
      });
      return;
    }

    // Validate references (preserve original semantics; throw inside try block).
    const currency = currencyId
      ? await prisma.currency.findUnique({ where: { id: currencyId } })
      : null;
    const timezone = timezoneId
      ? await prisma.timezone.findUnique({ where: { id: timezoneId } })
      : null;
    const dateFormat = dateFormatId
      ? await prisma.dateFormat.findUnique({ where: { id: dateFormatId } })
      : null;
    // The setup form sends `country` as a Country.id. Resolve it so we can also
    // persist the `countryId` FK — downstream ledger/tax resolution (country
    // pack) maps that FK to the ISO-2 code. Without it, pack resolution can't
    // identify the country and falls back to a default pack.
    const countryRow = country
      ? await prisma.country.findUnique({ where: { id: country } })
      : null;

    if (currencyId && !currency) throw new Error('Invalid Currency selected.');
    if (timezoneId && !timezone) throw new Error('Invalid Timezone selected.');
    if (dateFormatId && !dateFormat) throw new Error('Invalid Date Format selected.');

    let companyLogoUrl: string | null = null;
    if (req.file) {
      companyLogoUrl = `/uploads/company/${req.file.filename}`;
    }

    let companySettings = await prisma.companySettings.findUnique({ where: { userId } });

    const result = await prisma.$transaction(async (tx) => {
      if (companySettings) {
        if (companyLogoUrl && companySettings.siteLogo) {
          deleteOldFile(companySettings.siteLogo);
        }

        companySettings = await tx.companySettings.update({
          where: { userId },
          data: {
            companyName: companyName!,
            address: address ?? companySettings.address,
            country: country!,
            ...(countryRow ? { countryId: country! } : {}),
            state: state!,
            city: city!,
            pincode: pincode ?? companySettings.pincode,
            ...(companyLogoUrl ? { siteLogo: companyLogoUrl } : {}),
          },
        });
      } else {
        companySettings = await tx.companySettings.create({
          data: {
            companyName: companyName!,
            email: user.email || 'info@example.com',
            phone: user.phone || '9876543212',
            address: address ?? '',
            country: country!,
            ...(countryRow ? { countryId: country! } : {}),
            state: state!,
            city: city!,
            pincode: pincode ?? '',
            siteLogo: companyLogoUrl ?? '',
            userId,
          },
        });
      }

      // Update or create localization
      let localization = await tx.localization.findFirst({
        where: { userId, isActive: true },
      });

      const firstActiveTimeFormat = await tx.timeFormat.findFirst({
        where: { isActive: true },
      });
      const timeFormatId = firstActiveTimeFormat?.id ?? null;

      if (localization) {
        const locUpdates: Prisma.LocalizationUncheckedUpdateInput = {};
        if (timezoneId) locUpdates.timezoneId = timezoneId;
        if (dateFormatId) locUpdates.dateFormatId = dateFormatId;
        localization = await tx.localization.update({
          where: { id: localization.id },
          data: locUpdates,
        });
      } else if ((timezoneId || dateFormatId) && timeFormatId && timezoneId && dateFormatId) {
        // Original Mongoose model allowed nullable timezone/dateFormat refs; the
        // Prisma schema makes them required so we only create when all three
        // ids are present.
        localization = await tx.localization.create({
          data: {
            userId,
            timezoneId,
            dateFormatId,
            timeFormatId,
            startWeek: 'Monday',
            isActive: true,
          },
        });
      }

      // Update default currency if needed
      if (currencyId && currency) {
        await tx.currency.updateMany({
          where: { isDefault: true },
          data: { isDefault: false },
        });
        await tx.currency.update({
          where: { id: currencyId },
          data: { isDefault: true, status: true },
        });
      }

      return { companySettings, localization };
    });

    // Apply the country pack (chart of accounts + tax rates/groups + regime) for
    // the chosen country and seed onboarding lookups, now that CompanySettings
    // (with countryId) is committed. Shared with the settings-page save;
    // idempotent + non-fatal so it can never break setup completion.
    await autoInitLedgerForUser(userId);

    const baseUrl = buildBaseUrl(req);
    const responseData = {
      companySettings: {
        ...result.companySettings,
        companyLogo: result.companySettings.companyLogo
          ? `${baseUrl}${result.companySettings.companyLogo}`
          : null,
      },
      localization: result.localization
        ? {
            timezone: result.localization.timezoneId,
            dateFormat: result.localization.dateFormatId,
            timeFormat: result.localization.timeFormatId,
          }
        : null,
      currency: currency
        ? {
            // Return both `id` (Prisma / current frontend) and `_id` (legacy
            // alias) so mobile apps or external consumers using the old shape
            // continue to work after the Mongoose→Prisma migration.
            id: currency.id,
            _id: currency.id,
            name: currency.name,
            code: currency.code,
            symbol: currency.symbol,
            isDefault: currency.isDefault,
          }
        : null,
    };

    res.status(200).json({
      success: true,
      message: 'Company setup updated successfully',
      data: responseData,
    });
  } catch (err) {
    if (handleUnauthorized(res, err)) return;
    console.error('Error updating company setup:', err);

    if (req.file) {
      try {
        const filePath = path.join(
          __dirname,
          '../uploads/company',
          req.file.filename,
        );
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
        }
      } catch (fileError) {
        console.error('Error cleaning up file:', fileError);
      }
    }

    res.status(500).json({
      success: false,
      message: 'Failed to update company setup',
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

// Silence unused-warning helpers
void ({} as GeneralSetting);

// CommonJS interop for legacy JS routes that still use module-alias requires.
module.exports = {
  getCompanySettings,
  updateCompanySettings,
  getBasicDetails,
  updateCompanySetup,
  createOrUpdateGeneralSetting,
  listGeneralSettings,
};
module.exports.getCompanySettings = getCompanySettings;
module.exports.updateCompanySettings = updateCompanySettings;
module.exports.getBasicDetails = getBasicDetails;
module.exports.updateCompanySetup = updateCompanySetup;
module.exports.createOrUpdateGeneralSetting = createOrUpdateGeneralSetting;
module.exports.listGeneralSettings = listGeneralSettings;
