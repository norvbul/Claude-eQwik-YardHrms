#!/usr/bin/env node
/**
 * yardhrms-migrate — legacy YardHRMS (Google Sheets / Apps Script) → eQwik YardHRMS migration.
 *
 *   inventory  <exportDir>                                   list files, sheets, headers and row counts
 *   transform  <exportDir> --mapping m.json --out <dir>      normalise + validate (no database access)
 *   load       <dir> --tenant <slug|id> --actor <email> [--dry-run]
 *   reconcile  <dir> --tenant <slug|id>                      compare the tenant with the canonical data
 *
 * See tools/legacy-migration/README.md for the full runbook.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import dotenv from 'dotenv';
import ExcelJS from 'exceljs';
import { validateMapping } from './mapping';
import { parseCsv } from './read';
import { issuesToCsv, transform, type CanonicalDataset } from './transform';

dotenv.config({ path: process.env.DOTENV_PATH ?? path.resolve(__dirname, '../../../.env'), quiet: true });

function args(argv: string[]) {
  const pos: string[] = [];
  const flags: Record<string, string | true> = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) {
      const k = argv[i].slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith('--')) {
        flags[k] = next;
        i++;
      } else flags[k] = true;
    } else pos.push(argv[i]);
  }
  return { pos, flags };
}
const need = (flags: Record<string, string | true>, k: string) => {
  const v = flags[k];
  if (typeof v !== 'string') throw new Error(`--${k} is required`);
  return v;
};
const log = (m: string) => process.stdout.write(`${m}\n`);

async function inventory(dir: string) {
  const files = (await fs.readdir(dir)).filter((f) => /\.(csv|xlsx)$/i.test(f)).sort();
  if (!files.length) throw new Error(`No .csv or .xlsx files in ${dir}`);
  const out: unknown[] = [];
  for (const f of files) {
    const buf = await fs.readFile(path.join(dir, f));
    if (/\.csv$/i.test(f)) {
      const rows = parseCsv(buf.toString('utf8'));
      out.push({ file: f, sheet: null, headers: rows[0] ?? [], rows: Math.max(0, rows.length - 1) });
    } else {
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(buf as unknown as ArrayBuffer);
      for (const ws of wb.worksheets) {
        const headers = ((ws.getRow(1).values as unknown[]) ?? []).slice(1).map((v) => String(v ?? ''));
        out.push({ file: f, sheet: ws.name, hidden: ws.state !== 'visible', headers, rows: Math.max(0, ws.actualRowCount - 1) });
      }
    }
  }
  return out;
}

async function readDataset(dir: string): Promise<CanonicalDataset> {
  return JSON.parse(await fs.readFile(path.join(dir, 'canonical.json'), 'utf8'));
}

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  const { pos, flags } = args(rest);
  switch (cmd) {
    case 'inventory': {
      const inv = await inventory(pos[0] ?? '.');
      log(JSON.stringify(inv, null, 2));
      return 0;
    }
    case 'transform': {
      const mapping = validateMapping(JSON.parse(await fs.readFile(need(flags, 'mapping'), 'utf8')));
      const out = need(flags, 'out');
      const { dataset, issues } = await transform(pos[0] ?? '.', mapping);
      await fs.mkdir(out, { recursive: true });
      await fs.writeFile(path.join(out, 'canonical.json'), JSON.stringify(dataset, null, 2));
      await fs.writeFile(path.join(out, 'issues.csv'), issuesToCsv(issues));
      const errors = issues.filter((i) => i.severity === 'ERROR').length;
      log(`Canonical dataset: ${dataset.departments.length} departments, ${dataset.branches.length} branches, ${dataset.positions.length} positions, ${dataset.employees.length} employees, ${dataset.leaveBalances.length} leave balances, ${dataset.payrollHistory.length} payroll periods, ${dataset.licences.length} legacy licences`);
      log(`Issues: ${errors} errors, ${issues.length - errors} warnings → ${path.join(out, 'issues.csv')}`);
      log('canonical.json contains personal data (TRN/NIS/NHT). Keep it on encrypted storage and delete it after cutover sign-off.');
      return errors ? 2 : 0;
    }
    case 'load': {
      const dir = pos[0] ?? '.';
      const data = await readDataset(dir);
      const { withApp, resolveActor } = await import('./context');
      const { load } = await import('./load');
      return withApp(async (app, prisma) => {
        const actor = await resolveActor(prisma, need(flags, 'tenant'), need(flags, 'actor'));
        log(`Loading into ${actor.tenantName} as ${actor.user.email}${flags['dry-run'] ? ' (dry run)' : ''}`);
        const report = await load(app, prisma, actor, data, { dryRun: !!flags['dry-run'], log });
        await fs.writeFile(path.join(dir, flags['dry-run'] ? 'load-dry-run.json' : `load-report-${Date.now()}.json`), JSON.stringify(report, null, 2));
        log(JSON.stringify(report.summary));
        return report.rows.some((r) => r.outcome === 'REJECTED') ? 3 : 0;
      });
    }
    case 'reconcile': {
      const dir = pos[0] ?? '.';
      const data = await readDataset(dir);
      const { withApp } = await import('./context');
      const { reconcile } = await import('./reconcile');
      return withApp(async (_app, prisma) => {
        const t = await prisma.tenant.findFirst({ where: { OR: [{ id: need(flags, 'tenant') }, { slug: need(flags, 'tenant') }] } });
        if (!t) throw new Error('Tenant not found');
        const r = await reconcile(prisma, t.id, data);
        await fs.writeFile(path.join(dir, 'reconciliation.json'), JSON.stringify(r, null, 2));
        const failed = r.checks.filter((c) => !c.ok);
        log(`${r.checks.length - failed.length}/${r.checks.length} checks passed`);
        for (const f of failed.slice(0, 50)) log(`  ✗ ${f.check} [${f.subject}] expected ${f.expected}, got ${f.actual}`);
        for (const l of r.licences) log(`  licence ${l.installationId ?? '-'} ${l.companyName}: ${l.action}`);
        return r.passed ? 0 : 4;
      });
    }
    default:
      log('Usage: yardhrms-migrate <inventory|transform|load|reconcile> … (see README.md)');
      return cmd ? 1 : 0;
  }
}

main().then(
  (code) => process.exit(code),
  (e) => {
    process.stderr.write(`Error: ${(e as Error).message}\n`);
    process.exit(1);
  },
);
