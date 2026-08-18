/**
 * On-demand geo dataset importer — Countries + States.
 *
 * Reads the bundled slim file (prisma/data/geo-countries-states.json) and
 * upserts all rows into the Country and State tables.
 *
 * Key invariants:
 *  - Match-then-update by iso2 (countries) so seeded fixed ids (c-india etc.)
 *    are preserved.
 *  - Match-then-update by (country_id, state_code) then (country_id, name)
 *    for states so seeded fixed ids (s-mh, s-tn etc.) are preserved.
 *  - Idempotent: re-running updates rows but never creates duplicates.
 *  - NOT wired to server boot or runBaselineSeed.
 *
 * Usage:
 *   npm run prisma:import:geo
 *   ts-node prisma/importGeoDataset.ts
 */

import * as fs from 'fs';
import * as path from 'path';
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'crypto';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface SlimState {
  id: number;
  name: string | null;
  iso2: string | null;
  iso3166_2: string | null;
  type: string | null;
}

interface SlimCountry {
  id: number;
  name: string | null;
  iso2: string | null;
  iso3: string | null;
  phonecode: string | null;
  capital: string | null;
  currency: string | null;
  native: string | null;
  region: string | null;
  subregion: string | null;
  states: SlimState[];
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

export async function importGeoDataset(): Promise<void> {
  const prisma = new PrismaClient();

  try {
    const dataPath = path.join(__dirname, 'data', 'geo-countries-states.json');
    const raw = fs.readFileSync(dataPath, 'utf8');
    const sourceCountries: SlimCountry[] = JSON.parse(raw);

    console.log(`[geo] Loaded ${sourceCountries.length} countries from ${dataPath}`);

    // -----------------------------------------------------------------------
    // 1. Load existing countries keyed by UPPER(iso2) → id
    // -----------------------------------------------------------------------
    const existingCountries = await prisma.country.findMany({
      select: { id: true, iso2: true },
    });
    const existingCountryByIso2 = new Map<string, string>();
    for (const row of existingCountries) {
      if (row.iso2) {
        existingCountryByIso2.set(row.iso2.toUpperCase(), row.id);
      }
    }

    // -----------------------------------------------------------------------
    // 2. Countries: match-then-update by iso2; create uuid for new ones.
    //    Build sourceCountryId → kanakkuCountryId map for state FK resolution.
    // -----------------------------------------------------------------------
    let countriesInserted = 0;
    let countriesUpdated = 0;
    const sourceIdToKanakkuId = new Map<number, string>();

    for (const src of sourceCountries) {
      if (!src.name) {
        console.warn(`[geo] Skipping country with no name (source id=${src.id})`);
        continue;
      }

      const iso2Upper = src.iso2 ? src.iso2.toUpperCase() : null;
      const existingId = iso2Upper ? existingCountryByIso2.get(iso2Upper) : undefined;

      const fields = {
        name: src.name,
        iso3: src.iso3 ?? null,
        iso2: src.iso2 ?? null,
        phonecode: src.phonecode ?? null,
        capital: src.capital ?? null,
        currency: src.currency ?? null,
        native: src.native ?? null,
        region: src.region ?? null,
        subregion: src.subregion ?? null,
      };

      let kanakkuId: string;

      if (existingId) {
        // Keep existing id (preserves c-india, c-united-states, etc.)
        await prisma.country.update({ where: { id: existingId }, data: fields });
        kanakkuId = existingId;
        countriesUpdated++;
      } else {
        kanakkuId = randomUUID();
        await prisma.country.create({ data: { id: kanakkuId, ...fields } });
        countriesInserted++;
        // Register new iso2 so subsequent source rows resolve it
        if (iso2Upper) existingCountryByIso2.set(iso2Upper, kanakkuId);
      }

      sourceIdToKanakkuId.set(src.id, kanakkuId);
    }

    console.log(
      `[geo] Countries — inserted: ${countriesInserted}, updated: ${countriesUpdated}`
    );

    // -----------------------------------------------------------------------
    // 3. Load existing states keyed by:
    //    - "cid:CODE" → state id (primary match)
    //    - "cid:name" → state id (fallback match)
    //    Also track which ids come from the DB (for safe update vs insert).
    // -----------------------------------------------------------------------
    const existingStates = await prisma.state.findMany({
      select: { id: true, country_id: true, state_code: true, name: true },
    });

    // Maps: lookup key → state id (DB rows only)
    const dbStateByCodeKey = new Map<string, string>(); // "cid:CODE" → state id
    const dbStateByNameKey = new Map<string, string>(); // "cid:name" → state id
    // Set of ids that already exist in the DB (safe to UPDATE)
    const dbStateIds = new Set<string>();

    for (const row of existingStates) {
      dbStateIds.add(row.id);
      if (row.country_id && row.state_code) {
        dbStateByCodeKey.set(
          `${row.country_id}:${row.state_code.toUpperCase()}`,
          row.id
        );
      } else if (row.country_id && row.name) {
        // Only register name-key for states that have no code — coded states are
        // already unambiguously keyed; the name slot is a fallback for code-less ones.
        dbStateByNameKey.set(
          `${row.country_id}:${row.name.toLowerCase()}`,
          row.id
        );
      }
    }

    // -----------------------------------------------------------------------
    // 4. States: match-then-update for DB-existing rows; collect new for
    //    createMany. Use separate "seen" maps that include both DB rows and
    //    newly staged rows to prevent intra-batch duplicates without
    //    accidentally trying to UPDATE a not-yet-inserted row.
    // -----------------------------------------------------------------------
    let statesInserted = 0;
    let statesUpdated = 0;

    // "seen" maps track all keys (DB + new) so we skip true duplicates.
    // Only DB rows are eligible for UPDATE; new-staged rows are just skipped.
    const seenByCodeKey = new Map<string, string>(dbStateByCodeKey);
    const seenByNameKey = new Map<string, string>(dbStateByNameKey);

    const newStates: Array<{
      id: string;
      name: string;
      country_id: string;
      state_code: string | null;
    }> = [];

    for (const src of sourceCountries) {
      const kanakkuCountryId = sourceIdToKanakkuId.get(src.id);
      if (!kanakkuCountryId) continue; // country was skipped (no name)

      for (const state of src.states ?? []) {
        if (!state.name) continue; // skip nameless states

        const stateCode = state.iso2 ?? state.iso3166_2 ?? null;
        const stateCodeUpper = stateCode ? stateCode.toUpperCase() : null;

        const fields = {
          name: state.name,
          country_id: kanakkuCountryId,
          state_code: stateCode,
        };

        // Try matching by (country_id, state_code)
        const codeKey = stateCodeUpper
          ? `${kanakkuCountryId}:${stateCodeUpper}`
          : null;
        const matchedByCode = codeKey ? seenByCodeKey.get(codeKey) : undefined;

        // Fallback: match by (country_id, name)
        const nameKey = `${kanakkuCountryId}:${state.name.toLowerCase()}`;
        const matchedByName = seenByNameKey.get(nameKey);

        const matchedId = matchedByCode ?? matchedByName;

        if (matchedId) {
          if (dbStateIds.has(matchedId)) {
            // Row exists in DB — safe to UPDATE
            await prisma.state.update({ where: { id: matchedId }, data: fields });
            statesUpdated++;
            // Keep seen maps consistent; only fall back to name-key when no code
            if (codeKey) {
              seenByCodeKey.set(codeKey, matchedId);
            } else {
              seenByNameKey.set(nameKey, matchedId);
            }
          }
          // else: already staged as a new row in this run — skip (idempotent)
        } else {
          const newId = randomUUID();
          newStates.push({ id: newId, ...fields });
          // Register in seen maps to prevent intra-batch duplicates;
          // only fall back to name-key when no code
          if (codeKey) {
            seenByCodeKey.set(codeKey, newId);
          } else {
            seenByNameKey.set(nameKey, newId);
          }
        }
      }
    }

    // Batch-insert new states (skipDuplicates as safety net)
    if (newStates.length > 0) {
      const BATCH = 500;
      for (let i = 0; i < newStates.length; i += BATCH) {
        const chunk = newStates.slice(i, i + BATCH);
        await prisma.state.createMany({ data: chunk, skipDuplicates: true });
      }
      statesInserted = newStates.length;
    }

    console.log(
      `[geo] States — inserted: ${statesInserted}, updated: ${statesUpdated}`
    );
    console.log('[geo] Import complete.');
  } finally {
    await prisma.$disconnect();
  }
}

// ---------------------------------------------------------------------------
// CLI runner
// ---------------------------------------------------------------------------

if (require.main === module) {
  importGeoDataset()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('[geo] Import failed:', err);
      process.exit(1);
    });
}
