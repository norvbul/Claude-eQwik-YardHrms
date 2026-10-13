import ExcelJS from 'exceljs';

export const MAX_IMPORT_ROWS = 5000;

/** Minimal RFC 4180 CSV parser (quoted fields, escaped quotes, CRLF/LF). */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  const src = text.replace(/^\uFEFF/, '');
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (inQuotes) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else inQuotes = false;
      } else field += c;
      continue;
    }
    if (c === '"' && field === '') inQuotes = true;
    else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else field += c;
  }
  if (field !== '' || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((v) => v.trim() !== ''));
}

function cellToString(v: ExcelJS.CellValue): string {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === 'number') return String(v);
  if (typeof v === 'boolean') return v ? 'Y' : 'N';
  if (typeof v === 'string') return v;
  const o = v as any;
  if (o.richText) return o.richText.map((t: any) => t.text).join('');
  if (o.text !== undefined) return String(o.text);
  if (o.result !== undefined) return cellToString(o.result);
  if (o.error) return '';
  return String(v);
}

/** Parses the first worksheet of an .xlsx file or a .csv file into header + data rows. */
export async function parseSpreadsheet(buf: Buffer, fileName: string): Promise<{ headers: string[]; rows: string[][] }> {
  let matrix: string[][];
  if (fileName.toLowerCase().endsWith('.csv')) {
    matrix = parseCsv(buf.toString('utf8'));
  } else {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf as any);
    const ws = wb.worksheets.find((w) => w.state === 'visible' && w.name.toLowerCase() !== 'instructions') ?? wb.worksheets[0];
    if (!ws) throw new Error('The workbook has no worksheets');
    matrix = [];
    ws.eachRow({ includeEmpty: false }, (row) => {
      const values: string[] = [];
      for (let c = 1; c <= ws.columnCount; c++) values.push(cellToString(row.getCell(c).value).trim());
      if (values.some((v) => v !== '')) matrix.push(values);
    });
  }
  if (!matrix.length) throw new Error('The file is empty');
  const headers = matrix[0].map((h) => h.trim());
  const rows = matrix.slice(1).map((r) => headers.map((_, i) => (r[i] ?? '').trim()));
  if (rows.length > MAX_IMPORT_ROWS) throw new Error(`The file has ${rows.length} rows; the maximum per import is ${MAX_IMPORT_ROWS}`);
  return { headers, rows };
}

/** Auto-maps file headers to template keys by exact key or label match (case/space-insensitive). */
export function autoMap(headers: string[], columns: readonly { key: string; label: string }[]): Record<string, string> {
  const norm = (s: string) => s.toLowerCase().replace(/\(.*?\)/g, '').replace(/[^a-z0-9]/g, '');
  const mapping: Record<string, string> = {};
  for (const col of columns) {
    const match = headers.find((h) => norm(h) === norm(col.key) || norm(h) === norm(col.label));
    if (match) mapping[col.key] = match;
  }
  return mapping;
}

export async function buildTemplate(columns: readonly { key: string; label: string; required: boolean; help?: string }[], sheetName: string, example: string[], notes: string[]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'eQwik YardHRMS';
  const ws = wb.addWorksheet(sheetName);
  ws.addRow(columns.map((c) => c.label));
  ws.addRow(example);
  ws.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
  ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0B5D3B' } };
  columns.forEach((c, i) => {
    ws.getColumn(i + 1).width = Math.max(14, c.label.length + 2);
    ws.getColumn(i + 1).numFmt = '@';
  });
  const info = wb.addWorksheet('Instructions');
  info.addRow(['eQwik YardHRMS import template']).font = { bold: true, size: 14 };
  info.addRow([]);
  for (const n of notes) info.addRow([n]);
  info.addRow([]);
  info.addRow(['Column', 'Required', 'Notes']).font = { bold: true };
  for (const c of columns) info.addRow([c.label, c.required ? 'Yes' : 'No', c.help ?? '']);
  info.getColumn(1).width = 45;
  info.getColumn(3).width = 80;
  return Buffer.from(await wb.xlsx.writeBuffer());
}
