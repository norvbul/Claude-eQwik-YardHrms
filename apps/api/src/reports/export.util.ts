import ExcelJS from 'exceljs';
import PDFDocument from 'pdfkit';

export interface ReportColumn {
  key: string;
  label: string;
  type?: 'text' | 'money' | 'number' | 'date';
}

export interface ReportResult {
  title: string;
  columns: ReportColumn[];
  rows: Record<string, unknown>[];
  totals?: Record<string, unknown>;
  parameters?: Record<string, unknown>;
}

const cell = (v: unknown) => (v === null || v === undefined ? '' : String(v));

/** CSV with spreadsheet formula-injection protection. */
export function toCsv(r: ReportResult): Buffer {
  const esc = (v: unknown) => {
    const s = cell(v);
    const safe = /^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s) ? `'${s}` : s;
    return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
  };
  const lines = [r.columns.map((c) => esc(c.label)).join(',')];
  for (const row of r.rows) lines.push(r.columns.map((c) => esc(row[c.key])).join(','));
  if (r.totals) lines.push(r.columns.map((c, i) => esc(i === 0 ? 'TOTAL' : r.totals![c.key] ?? '')).join(','));
  return Buffer.from('﻿' + lines.join('\r\n') + '\r\n', 'utf8');
}

export async function toXlsx(r: ReportResult, companyName: string): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'eQwik YardHRMS';
  const ws = wb.addWorksheet(r.title.slice(0, 31));
  ws.addRow([companyName]).font = { bold: true, size: 14 };
  ws.addRow([r.title]).font = { bold: true };
  ws.addRow([`Generated ${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC`]);
  ws.addRow([]);
  const header = ws.addRow(r.columns.map((c) => c.label));
  header.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  header.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0B5D3B' } };
  for (const row of r.rows) {
    ws.addRow(r.columns.map((c) => (c.type === 'money' || c.type === 'number') && row[c.key] !== null && row[c.key] !== '' && row[c.key] !== undefined ? Number(row[c.key]) : cell(row[c.key])));
  }
  if (r.totals) {
    const t = ws.addRow(r.columns.map((c, i) => (i === 0 ? 'TOTAL' : r.totals![c.key] !== undefined ? Number(r.totals![c.key]) : '')));
    t.font = { bold: true };
  }
  r.columns.forEach((c, i) => {
    ws.getColumn(i + 1).width = Math.max(12, c.label.length + 4);
    if (c.type === 'money') ws.getColumn(i + 1).numFmt = '#,##0.00';
  });
  return Buffer.from(await wb.xlsx.writeBuffer());
}

export function toPdf(r: ReportResult, companyName: string, banner?: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margin: 30 });
    const chunks: Buffer[] = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    const W = doc.page.width - 60;
    const header = () => {
      doc.fillColor('#0b5d3b').fontSize(14).font('Helvetica-Bold').text(companyName, 30, 30);
      doc.fillColor('#0f172a').fontSize(11).text(r.title, 30, 48);
      doc.fontSize(8).font('Helvetica').fillColor('#64748b').text(`Generated ${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC · eQwik YardHRMS™`, 30, 63);
      if (banner) doc.fillColor('#92400e').text(banner, 30, 74);
      return banner ? 90 : 80;
    };
    let y = header();
    const colW = W / r.columns.length;
    const drawHead = () => {
      doc.rect(30, y, W, 16).fill('#0b5d3b');
      doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(7.5);
      r.columns.forEach((c, i) => doc.text(c.label, 32 + i * colW, y + 4, { width: colW - 4, align: c.type === 'money' || c.type === 'number' ? 'right' : 'left' }));
      y += 18;
      doc.font('Helvetica').fillColor('#0f172a');
    };
    drawHead();
    const drawRow = (row: Record<string, unknown>, bold = false) => {
      if (y > doc.page.height - 40) {
        doc.addPage();
        y = header();
        drawHead();
      }
      doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(7.5);
      r.columns.forEach((c, i) => doc.text(cell(row[c.key]), 32 + i * colW, y, { width: colW - 4, align: c.type === 'money' || c.type === 'number' ? 'right' : 'left', lineBreak: false, ellipsis: true }));
      y += 12;
    };
    r.rows.forEach((row) => drawRow(row));
    if (r.totals) drawRow({ ...r.totals, [r.columns[0].key]: 'TOTAL' }, true);
    doc.end();
  });
}
