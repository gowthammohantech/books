/**
 * Baseline seed — runs by default for fresh installs (CodeCanyon customers).
 *
 * Seeds ONLY the lookup data that the onboarding flow needs:
 *   - System bootstrap user (user_type=999, doesn't count as admin so
 *     /api/admin/app-version still reports `new_register: true`)
 *   - Countries / States / Cities (a handful — enough to demo)
 *   - Timezones / DateFormats / TimeFormats

 * Units, Currencies and EmailTemplates moved OUT of this file in P4: they
 * are tenant-owned now, and prisma/seedTenant.ts stocks them per workspace.
 * What is left here is genuinely platform-wide reference data that every
 * company on the install shares and none of them can edit.
 *
 * Does NOT create an admin user. The frontend will render /register on
 * first run so the customer goes through the onboarding flow.
 *
 * For the CodeCanyon public demo (with admin@demo.elixirbooks.local /
 * Demo123$ already provisioned), run `npm run prisma:seed:demo` AFTER
 * `npm run prisma:seed`.
 *
 * Idempotent — re-running is safe.
 *
 * Exports:
 *   runBaselineSeed() — callable in-process (server.js boot bootstrap).
 *                       Creates its own PrismaClient and disconnects it when
 *                       done, so the app's shared client is untouched.
 *                       Sub-seed helpers (seedModules, seedRoles, etc.) each
 *                       manage their own connections independently.
 */

import { PrismaClient } from '@prisma/client';

import { runAsSystem } from '../lib/tenantContext';

import { seedModules } from './seedModules';
import { seedFieldTypes } from './seedFieldTypes';
import { seedNotifications } from './seedNotifications';
import { seedAllTenantDefaults } from './seedTenant';
import { seedRoles } from './seedRoles';
import { backfillTenantMemberships } from './backfillTenantMemberships';
import { seedTransactionCategories } from './seedTransactionCategories';
import { encryptLegacyEmailSecrets } from './encryptLegacyEmailSecrets';
import { importGeoDataset } from './importGeoDataset';

/**
 * Run all idempotent baseline seeds. A dedicated PrismaClient is created for
 * the direct DB operations in this function and disconnected before returning.
 * Sub-seed helpers manage their own clients. Safe to call from the boot
 * bootstrap in server.js — it does NOT interfere with the app's shared
 * PrismaClient from lib/prisma.
 */
export async function runBaselineSeed(): Promise<void> {
  // EVERY sub-seeder and backfill below runs with the tenant guard bypassed.
  // They are platform-level by definition — geo data, modules, notification
  // types — and the per-tenant ones (seedAllTenantDefaults,
  // seedTransactionCategories) name their tenant explicitly rather than
  // inheriting one. Without this, boot fails on the first backfill that
  // touches a tenant-scoped table through the shared client: with the guard
  // enforcing, "no tenant in context" is an error, which is exactly what makes
  // an unscoped query impossible to write by accident.
  return runAsSystem(() => runBaselineSeedInner());
}

async function runBaselineSeedInner(): Promise<void> {
  // A fresh PrismaClient scoped to this call so we can cleanly disconnect
  // the direct writes here without affecting the application's shared instance.
  const prisma = new PrismaClient();

  try {
    // -------------------------------------------------------------------------
    // System bootstrap user (needed as a FK target for Currency.createdBy).
    // user_type=999 so app-version doesn't count it as an admin.
    // -------------------------------------------------------------------------
    await prisma.user.upsert({
      where: { id: 'sys-bootstrap' },
      update: {},
      create: {
        id: 'sys-bootstrap',
        firstName: 'System',
        lastName: 'Bootstrap',
        email: 'system@elixirbooks.internal',
        password: '$2b$10$disabled',
        user_type: 999,
        balance: 0,
        isDeleted: false,
      },
    });

    // -------------------------------------------------------------------------
    // Countries
    // -------------------------------------------------------------------------
    const countries = [
      { id: 'c-india', name: 'India', iso3: 'IND', iso2: 'IN', phonecode: '91', capital: 'New Delhi', currency: 'INR' },
      { id: 'c-united-states', name: 'United States', iso3: 'USA', iso2: 'US', phonecode: '1', capital: 'Washington', currency: 'USD' },
      { id: 'c-united-kingdom', name: 'United Kingdom', iso3: 'GBR', iso2: 'GB', phonecode: '44', capital: 'London', currency: 'GBP' },
      { id: 'c-australia', name: 'Australia', iso3: 'AUS', iso2: 'AU', phonecode: '61', capital: 'Canberra', currency: 'AUD' },
      { id: 'c-canada', name: 'Canada', iso3: 'CAN', iso2: 'CA', phonecode: '1', capital: 'Ottawa', currency: 'CAD' },
      { id: 'c-germany', name: 'Germany', iso3: 'DEU', iso2: 'DE', phonecode: '49', capital: 'Berlin', currency: 'EUR' },
      { id: 'c-france', name: 'France', iso3: 'FRA', iso2: 'FR', phonecode: '33', capital: 'Paris', currency: 'EUR' },
      { id: 'c-singapore', name: 'Singapore', iso3: 'SGP', iso2: 'SG', phonecode: '65', capital: 'Singapore', currency: 'SGD' },
      { id: 'c-uae', name: 'United Arab Emirates', iso3: 'ARE', iso2: 'AE', phonecode: '971', capital: 'Abu Dhabi', currency: 'AED' },
      { id: 'c-japan', name: 'Japan', iso3: 'JPN', iso2: 'JP', phonecode: '81', capital: 'Tokyo', currency: 'JPY' },
    ];
    for (const c of countries) {
      await prisma.country.upsert({ where: { id: c.id }, update: c, create: c });
    }

    // -------------------------------------------------------------------------
    // States
    // -------------------------------------------------------------------------
    const states = [
      { id: 's-tn', name: 'Tamil Nadu', country_id: 'c-india', state_code: 'TN' },
      { id: 's-ka', name: 'Karnataka', country_id: 'c-india', state_code: 'KA' },
      { id: 's-mh', name: 'Maharashtra', country_id: 'c-india', state_code: 'MH' },
      { id: 's-dl', name: 'Delhi', country_id: 'c-india', state_code: 'DL' },
      { id: 's-kl', name: 'Kerala', country_id: 'c-india', state_code: 'KL' },
      { id: 's-tg', name: 'Telangana', country_id: 'c-india', state_code: 'TG' },
      { id: 's-ca', name: 'California', country_id: 'c-united-states', state_code: 'CA' },
      { id: 's-ny', name: 'New York', country_id: 'c-united-states', state_code: 'NY' },
      { id: 's-tx', name: 'Texas', country_id: 'c-united-states', state_code: 'TX' },
      { id: 's-fl', name: 'Florida', country_id: 'c-united-states', state_code: 'FL' },
      { id: 's-eng', name: 'England', country_id: 'c-united-kingdom', state_code: 'ENG' },
      { id: 's-sco', name: 'Scotland', country_id: 'c-united-kingdom', state_code: 'SCO' },
    ];
    for (const s of states) {
      await prisma.state.upsert({ where: { id: s.id }, update: s, create: s });
    }

    // -------------------------------------------------------------------------
    // Cities
    // -------------------------------------------------------------------------
    const cities = [
      { id: 'ci-chennai', name: 'Chennai', state_id: 's-tn', country_id: 'c-india' },
      { id: 'ci-coimbatore', name: 'Coimbatore', state_id: 's-tn', country_id: 'c-india' },
      { id: 'ci-madurai', name: 'Madurai', state_id: 's-tn', country_id: 'c-india' },
      { id: 'ci-bangalore', name: 'Bangalore', state_id: 's-ka', country_id: 'c-india' },
      { id: 'ci-mysore', name: 'Mysore', state_id: 's-ka', country_id: 'c-india' },
      { id: 'ci-mumbai', name: 'Mumbai', state_id: 's-mh', country_id: 'c-india' },
      { id: 'ci-pune', name: 'Pune', state_id: 's-mh', country_id: 'c-india' },
      { id: 'ci-delhi', name: 'New Delhi', state_id: 's-dl', country_id: 'c-india' },
      { id: 'ci-kochi', name: 'Kochi', state_id: 's-kl', country_id: 'c-india' },
      { id: 'ci-hyd', name: 'Hyderabad', state_id: 's-tg', country_id: 'c-india' },
      { id: 'ci-sf', name: 'San Francisco', state_id: 's-ca', country_id: 'c-united-states' },
      { id: 'ci-la', name: 'Los Angeles', state_id: 's-ca', country_id: 'c-united-states' },
      { id: 'ci-nyc', name: 'New York City', state_id: 's-ny', country_id: 'c-united-states' },
      { id: 'ci-austin', name: 'Austin', state_id: 's-tx', country_id: 'c-united-states' },
      { id: 'ci-miami', name: 'Miami', state_id: 's-fl', country_id: 'c-united-states' },
      { id: 'ci-london', name: 'London', state_id: 's-eng', country_id: 'c-united-kingdom' },
      { id: 'ci-manchester', name: 'Manchester', state_id: 's-eng', country_id: 'c-united-kingdom' },
      { id: 'ci-edinburgh', name: 'Edinburgh', state_id: 's-sco', country_id: 'c-united-kingdom' },
    ];
    for (const c of cities) {
      await prisma.city.upsert({ where: { id: c.id }, update: c, create: c });
    }

    // -------------------------------------------------------------------------
    // Full country/state dataset (250 countries / 5308 states).
    // The handful seeded above is enough to demo, but real installs need the
    // complete list so state dropdowns aren't empty. importGeoDataset() is
    // idempotent and preserves the fixed ids (c-india, s-tn, ...) seeded above.
    // Guarded by a state-count check so it only runs on fresh installs and does
    // not re-scan all 5308 rows on every boot.
    // -------------------------------------------------------------------------
    try {
      const stateCount = await prisma.state.count();
      if (stateCount < 100) {
        await importGeoDataset();
      }
    } catch (geoErr) {
      console.warn('[seed] full geo import skipped (non-fatal):', geoErr);
    }

    // Units moved to prisma/seedTenant.ts (P4) — a Unit belongs to one
    // workspace now, so there is no install-wide set to create here.

    // -------------------------------------------------------------------------
    // Timezones
    // -------------------------------------------------------------------------
    const timezones = [
      { id: 'tz-ist', name: 'Asia/Kolkata', utc_offset: '+05:30' },
      { id: 'tz-utc', name: 'UTC', utc_offset: '+00:00' },
      { id: 'tz-est', name: 'America/New_York', utc_offset: '-05:00' },
      { id: 'tz-pst', name: 'America/Los_Angeles', utc_offset: '-08:00' },
      { id: 'tz-gmt', name: 'Europe/London', utc_offset: '+00:00' },
      { id: 'tz-cet', name: 'Europe/Paris', utc_offset: '+01:00' },
      { id: 'tz-jst', name: 'Asia/Tokyo', utc_offset: '+09:00' },
      { id: 'tz-gst', name: 'Asia/Dubai', utc_offset: '+04:00' },
      { id: 'tz-aest', name: 'Australia/Sydney', utc_offset: '+10:00' },
      { id: 'tz-sgt', name: 'Asia/Singapore', utc_offset: '+08:00' },
    ];
    for (const tz of timezones) {
      await prisma.timezone.upsert({ where: { id: tz.id }, update: tz, create: tz });
    }

    // -------------------------------------------------------------------------
    // Date formats
    // -------------------------------------------------------------------------
    const dateFormats = [
      { id: 'df-dmy-slash', title: 'DD/MM/YYYY', format: 'DD/MM/YYYY', isActive: true, isDeleted: false },
      { id: 'df-mdy-slash', title: 'MM/DD/YYYY', format: 'MM/DD/YYYY', isActive: true, isDeleted: false },
      { id: 'df-ymd-dash', title: 'YYYY-MM-DD', format: 'YYYY-MM-DD', isActive: true, isDeleted: false },
      { id: 'df-dmy-dash', title: 'DD-MM-YYYY', format: 'DD-MM-YYYY', isActive: true, isDeleted: false },
    ];
    for (const df of dateFormats) {
      await prisma.dateFormat.upsert({ where: { id: df.id }, update: df, create: df });
    }

    // -------------------------------------------------------------------------
    // Time formats
    // -------------------------------------------------------------------------
    // Tokens are PHP-style (see useDateFormatter.tsx): H/i are the 24h-hour and
    // minute tokens. "HH:mm"/"hh:mm A" (Moment/CLDR-style tokens) are NOT
    // recognized by that parser — H and m each match twice, rendering
    // "1818:0707" style garbage (hour doubled; lowercase "m" is month here,
    // not minutes). Use the app's actual tokens: H/h already zero-pad.
    const timeFormats = [
      { id: 'tf-24h', name: '24 Hour', format: 'H:i', isActive: true, isDeleted: false },
      { id: 'tf-12h', name: '12 Hour', format: 'h:i A', isActive: true, isDeleted: false },
    ];
    for (const tf of timeFormats) {
      await prisma.timeFormat.upsert({ where: { id: tf.id }, update: tf, create: tf });
    }

    // Currencies moved to prisma/seedTenant.ts (P4). They were seeded here
    // with fixed ids and a `sys-bootstrap` createdBy because one install had
    // exactly one currency list; each workspace owns its own list now, and
    // that seeder carries the same do-not-resurrect-user-deletions rule the
    // upsert here spelled out.

    // -------------------------------------------------------------------------
    // Payment modes — the dropdown on every "record payment" screen reads from
    // this table. Previously only seed-demo-full.ts created them, so fresh
    // installs had an empty/unsettable payment-mode dropdown (QA #9/#30).
    // Upsert by slug so re-running is safe and existing installs get them.
    // -------------------------------------------------------------------------
    const paymentModes = [
      { name: 'Cash', slug: 'cash' },
      { name: 'Bank Transfer', slug: 'bank-transfer' },
      { name: 'UPI', slug: 'upi' },
      { name: 'Card', slug: 'card' },
      { name: 'Cheque', slug: 'cheque' },
      // Redeem a customer's Account Credit balance to settle an invoice — no
      // real cash/bank movement (see cashRoleFor's 'account-credit' branch).
      { name: 'Account Credit', slug: 'account-credit' },
    ];
    for (const pm of paymentModes) {
      await prisma.paymentMode.upsert({
        where: { slug: pm.slug },
        // Refresh the name only — don't force status back to true on every boot,
        // which would re-enable a payment mode the tenant deliberately disabled.
        update: { name: pm.name },
        create: { name: pm.name, slug: pm.slug, status: true },
      });
    }
  } finally {
    await prisma.$disconnect();
  }

  // Sub-seed helpers each manage their own PrismaClient connections.
  // -------------------------------------------------------------------------
  // Module hierarchy + custom-field type catalog. These drive the
  // roles/permissions tree and the Settings > Module Settings (custom fields)
  // screens. Both are idempotent. Without them, fresh installs show an empty
  // module tree and "Module … could not be found" on the module-settings pages.
  // -------------------------------------------------------------------------
  const mods = await seedModules();
  console.log(`Modules seeded (created ${mods.created} new).`);
  const fts = await seedFieldTypes();
  console.log(`Field types seeded (created ${fts.created} new).`);

  // Notification types + tags drive the Email Templates / notification settings
  // screens. Idempotent. (EmailTemplate rows are user-created.)
  const notifs = await seedNotifications();
  console.log(`Notifications seeded (created ${notifs.types} types, ${notifs.tags} tags, ${notifs.links} links).`);

  // Per-tenant defaults (Units, Currencies, EmailTemplates). This is the
  // reconciliation half: it reaches workspaces that already exist, so a
  // release adding a template or a unit does not only benefit companies
  // that sign up afterwards. New workspaces get the same content at signup,
  // inside the registration transaction. On a fresh install there are no
  // tenants yet and this is a no-op.
  const tenantDefaults = await seedAllTenantDefaults();
  console.log(
    `Tenant defaults seeded across ${tenantDefaults.tenants} tenant(s) ` +
      `(${tenantDefaults.units} unit(s), ${tenantDefaults.currencies} currency(ies), ` +
      `${tenantDefaults.emailTemplates} template(s)).`,
  );

  // Default roles (Admin, Vendor, Staff, Maintainer, Supplier) + backfill
  // existing users that have no roleId.
  const roles = await seedRoles();
  console.log(
    `Roles seeded (created ${roles.created} new, backfilled ${roles.backfilled} users, granted Admin role ${roles.adminPermsGranted} module permissions, assigned Owner to ${roles.ownerAssigned} owner(s)).`,
  );

  // Membership backfill: authMiddleware.protect resolves the workspace from
  // TenantMembership and 401s without one, so a user who somehow lacks a
  // membership cannot sign in. This heals that. Idempotent — safe on every
  // boot, and it never guesses when the workspace is ambiguous.
  const memberships = await backfillTenantMemberships();
  if (memberships.created > 0 || memberships.skipped > 0) {
    console.log(
      `Tenant membership backfill (created ${memberships.created}, skipped ${memberships.skipped}).`,
    );
  }

  // Money In/Out category catalog (per ledger-initialized company) + legacy
  // ExpenseCategory migration. Idempotent — owners without a ledger mapping are
  // skipped; existing categories are left untouched.
  const txc = await seedTransactionCategories();
  console.log(`Transaction categories seeded (created ${txc.created}, migrated ${txc.migrated}).`);

  // Encrypt any legacy plaintext email-provider secrets in place. Idempotent —
  // already-encrypted values are skipped.
  const enc = await encryptLegacyEmailSecrets();
  if (enc.encrypted > 0) console.log(`Encrypted ${enc.encrypted} legacy email secret(s).`);

  console.log('Baseline seed complete: lookup data ready.');
  console.log('Fresh installs: visit / and use the onboarding flow (register → setup).');
  console.log('For CodeCanyon demo, also run:  npx ts-node prisma/seed-demo.ts');
}

// ---------------------------------------------------------------------------
// Standalone runner — invoked by `prisma db seed` or `npx ts-node prisma/seed.ts`
// ---------------------------------------------------------------------------
async function main(): Promise<void> {
  await runBaselineSeed();
}

if (require.main === module) {
  main()
    .catch((err) => {
      console.error('Seed failed:', err);
      process.exit(1);
    });
}

// CommonJS interop so server.js (plain JS) can: require('./prisma/seed').runBaselineSeed()
module.exports = { runBaselineSeed };
module.exports.runBaselineSeed = runBaselineSeed;
