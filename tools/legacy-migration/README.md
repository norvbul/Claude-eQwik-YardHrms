# Legacy migration tool (`yardhrms-migrate`)

Operator tooling for PRD §14: moving a customer from the legacy YardHRMS (Google Apps Script + Google
Sheets / ObjDB) into eQwik YardHRMS. Migration is a **managed ETL engagement**, not an automatic
replacement of the production database. The tool is run by a Qwik migration officer with database access,
acting as a named Company Administrator of the target tenant.

```
pnpm --filter @yardhrms/api build           # the tool reuses the API's services and rules
pnpm --filter @yardhrms/legacy-migration build
node tools/legacy-migration/dist/cli.js <command> …
```

| Command | Touches the database | Purpose |
|---|---|---|
| `inventory <exportDir>` | no | Lists every CSV/XLSX file and worksheet with headers and row counts |
| `transform <exportDir> --mapping m.json --out <work>` | no | Maps columns, normalises values, validates, deduplicates → `canonical.json` + `issues.csv` |
| `load <work> --tenant <slug\|id> --actor <email> [--dry-run]` | yes | Writes the canonical data into one tenant; idempotent |
| `reconcile <work> --tenant <slug\|id>` | read-only | Compares the tenant against `canonical.json`; licence reconciliation report |

Exit codes: `0` success, `1` usage/fatal error, `2` transform found errors, `3` load rejected rows,
`4` reconciliation mismatches.

## Runbook

1. **Inventory** — export every legacy Sheet tab to CSV or download the spreadsheet as XLSX; collect
   script configuration, reference sheets, employee documents and any legacy licence records. Run
   `inventory` and file the output with the engagement records.
2. **Map** — copy `samples/mapping.sample.json` and point each canonical field at the legacy header.
   Set `dateOrder` (`DMY` for most Jamaican sheets). Add `values` translation tables for local codes
   (e.g. `"payFrequency": { "Bi-Weekly": "FORTNIGHTLY" }`). Unknown sources/fields are rejected.
3. **Normalise & validate** — run `transform`. Every rejected or suspicious row appears in `issues.csv`
   with source, row number, legacy ID, field and reason. Fix the *source* (or the mapping) and re-run
   until there are no errors you are not deliberately leaving behind. Checks include: required fields,
   date validity, money format, 9-digit TRN, duplicate TRN / name+DOB (possible duplicate people),
   duplicate legacy IDs and employee numbers, unknown department/branch/position references, monthly
   employees configured as hourly (not allowed — monthly staff never submit regular timesheets),
   termination before hire, leave balances for unknown employees, and payroll lines where
   gross − deductions ≠ net (so no historical result is silently altered).
4. **Prepare the tenant** — create the company (self sign-up or by Qwik), make sure its subscription
   covers the number of **active** employees (the tool refuses to exceed capacity; historical
   terminated employees do not consume seats), create any extra leave types referenced by the export,
   and invite the operator as a Company Administrator (MFA is required).
5. **Load** — run with `--dry-run` first (capacity preflight, nothing written), then for real. Order:
   departments → branches → positions → employees → leave opening balances → payroll history.
   - Each record is written in its own transaction together with a `legacy_id_map` row
     (`tenant_id, entity_type, legacy_id → new_id`). Re-running skips anything already migrated, which is
     how the **final delta import** at cutover works.
   - Reference data with an existing code is matched rather than duplicated.
   - Employees are created through the API's `EmployeesService` (same validation, TRN/NIS/NHT
     field encryption, compensation/employment history and audit events) with `source = MIGRATION`.
     Legacy employee numbers are kept when free; otherwise a new number is allocated.
   - Leave balances become append-only `OPENING` ledger entries with posting key `legacy-opening`.
   - Each legacy pay period becomes a **LOCKED** payroll run numbered `LEGACY-<W|F|M><yyyymmdd>` whose
     lines reproduce the approved legacy amounts (not recalculated). Payslips are queued for PDF
     generation and are marked "Historical record — imported from the legacy YardHRMS system".
     A period that already exists in the new system is rejected rather than merged.
   - A `load-report-<timestamp>.json` lists every row as CREATED / MATCHED / SKIPPED_EXISTING / REJECTED.
6. **Validate** — run `reconcile` (after the worker has generated payslips). It compares record counts,
   every employee profile (name, hire date, pay frequency/type/rate, status), every leave opening
   balance, payroll gross/net totals, employee counts and lock state per period, and historical payslip
   availability. Results are written to `reconciliation.json`.
7. **Parallel run** — process one full pay cycle in the new engine alongside the legacy approved
   payroll and resolve every difference with payroll/finance sign-off. The new engine's statutory rules
   must first be entered from authoritative sources and approved (see `docs/payroll-configuration.md`).
8. **Cutover** — freeze legacy writes, re-export, `transform`, `load` (delta), `reconcile`, provision user
   access, complete the acceptance checklist.
9. **Rollback** — keep the legacy spreadsheets and Apps Script deployment read-only and backed up until the
   cutover is formally approved. Migrated records are identifiable by `legacy_id_map`, `source = MIGRATION`
   and `migration.*` audit events; before approval a failed migration is rolled back by restoring the
   pre-migration database backup (never by hand-deleting payroll, which the database forbids).

## Legacy licences

The old per-deployment InstallationID, Script Properties, signed `doPost` validation and `LOCAL_FREE`
cache are **not** carried over. `reconcile` produces a licence reconciliation list (legacy installation,
company, licence type, expiry → matched tenant, current plan, recommended action). Paid plans are
activated only through the Licence Manager with a verified manual payment or a reasoned commercial
override — the migration tool never grants paid entitlements.

## Data protection

`canonical.json` and the export directory contain personal data (TRN, NIS, NHT, salaries). Keep them on
encrypted storage with access limited to the migration team, never commit them (the repository ignores
`tools/legacy-migration/input/`), and delete them after cutover sign-off. Bank account details are
deliberately **not** migrated by this tool; they must be re-captured and verified by the employer.

## Samples

`samples/export/` is a small **synthetic** export (fictional people, invented amounts that are not
statutory rates) containing deliberate defects; `src/migration.test.ts` asserts that each defect is
reported. Try it:

```
node dist/cli.js transform samples/export --mapping samples/mapping.sample.json --out /tmp/mig
```
