import fs from 'node:fs/promises';
import path from 'node:path';
import ExcelJS from 'exceljs';
import type { SourceMapping } from './mapping';

export interface SheetData {
  file: string;
  sheet: string | null;
  headers: string[];
  rows: string[][];
}

const norm = (s: string) => s.toLowerCase().replace(/[\s_\-./()]+/g, '');

/** RFC 4180 CSV parser (quoted fields, embedded newlines/quotes, BOM). */
export function parseCsv(text: string): string[][] {
  const src = text.replace(/^\uFEFF/, '');
  const out: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) {
      if (c === '"' && src[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i++;
      row.push(field);
      out.push(row);
      row = [];
      field = '';
    } else field += c;
  }
  if (field !== '' || row.length) {
    row.push(field);
    out.push(row);
  }
  return out.filter((r) => r.some((v) => v.trim() !== ''));
}

function cellText(v: ExcelJS.CellValue): string {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === 'object') {
    if ('result' in v && v.result !== undefined) return cellText(v.result as ExcelJS.CellValue);
    if ('text' in v) return String((v as { text: unknown }).text);
    if ('richText' in v) return (v as ExcelJS.CellRichTextValue).richText.map((r) => r.text).join('');
    return '';
  }
  return String(v);
}

export async function readSheet(dir: string, src: Pick<SourceMapping, 'file' | 'sheet'>): Promise<SheetData> {
  const full = path.resolve(dir, src.file);
  if (!full.startsWith(path.resolve(dir) + path.sep)) throw new Error(`File ${src.file} is outside the export directory`);
  const buf = await fs.readFile(full);
  let matrix: string[][];
  let sheet: string | null = null;
  if (full.toLowerCase().endsWith('.csv')) matrix = parseCsv(buf.toString('utf8'));
  else {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf as unknown as ArrayBuffer);
    const ws = src.sheet ? wb.getWorksheet(src.sheet) : (wb.worksheets.find((w) => w.state === 'visible') ?? wb.worksheets[0]);
    if (!ws) throw new Error(`Worksheet ${src.sheet ?? '(first)'} not found in ${src.file}`);
    sheet = ws.name;
    matrix = [];
    ws.eachRow({ includeEmpty: false }, (r) => {
      const vals: string[] = [];
      for (let c = 1; c <= ws.columnCount; c++) vals.push(cellText(r.getCell(c).value).trim());
      if (vals.some((v) => v !== '')) matrix.push(vals);
    });
  }
  if (!matrix.length) return { file: src.file, sheet, headers: [], rows: [] };
  const headers = matrix[0].map((h) => h.trim());
  return { file: src.file, sheet, headers, rows: matrix.slice(1).map((r) => headers.map((_, i) => (r[i] ?? '').trim())) };
}

/** Projects raw rows into records keyed by canonical field names using the mapping. */
export function project(data: SheetData, src: SourceMapping): { records: Record<string, string>[]; missingColumns: string[] } {
  const index = new Map(data.headers.map((h, i) => [norm(h), i]));
  const missingColumns: string[] = [];
  const cols = Object.entries(src.columns).map(([field, header]) => {
    const i = index.get(norm(header));
    if (i === undefined) missingColumns.push(`${field} ← "${header}"`);
    return [field, i] as const;
  });
  const records = data.rows.map((r) => {
    const rec: Record<string, string> = {};
    for (const [field, i] of cols) {
      let v = i === undefined ? '' : (r[i] ?? '');
      const table = src.values?.[field];
      if (table && v !== '') {
        const hit = Object.entries(table).find(([k]) => norm(k) === norm(v));
        if (hit) v = hit[1];
      }
      rec[field] = v;
    }
    return rec;
  });
  return { records, missingColumns };
}
