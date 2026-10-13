import PDFDocument from 'pdfkit';

const NAVY = '#1e1b4b';
const GOLD = '#f5b301';

export interface Party {
  name: string;
  lines: string[];
}
export interface DocLine {
  description: string;
  quantity?: string;
  unitPrice?: string;
  amount: string;
}
export interface BillingDoc {
  title: 'INVOICE' | 'RECEIPT' | 'STATEMENT';
  number?: string;
  meta: [string, string][];
  seller: Party;
  customer: Party;
  columns: 'invoice' | 'statement';
  lines: DocLine[];
  statementRows?: { date: string; description: string; debit: string; credit: string; balance: string }[];
  totals: [string, string, boolean?][];
  notes: string[];
  stamp?: { text: string; color: string };
}

const money = (v: string) => Number(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function renderBillingPdf(d: BillingDoc): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 40, info: { Title: `${d.title} ${d.number ?? ''}`.trim(), Author: d.seller.name, Creator: 'Qwik Licence & Subscription Manager' } });
    const chunks: Buffer[] = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    const W = doc.page.width - 80;

    doc.rect(40, 40, W, 74).fill(NAVY);
    doc.rect(40, 114, W, 4).fill(GOLD);
    doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(16).text(d.seller.name, 55, 52, { width: W / 2 });
    doc.font('Helvetica').fontSize(8.5).text(d.seller.lines.filter(Boolean).join('\n'), 55, 72, { width: W / 2 });
    doc.font('Helvetica-Bold').fontSize(20).text(d.title, 40, 52, { width: W - 15, align: 'right' });
    if (d.number) doc.font('Helvetica').fontSize(10).text(d.number, 40, 78, { width: W - 15, align: 'right' });

    let y = 134;
    doc.fillColor('#64748b').font('Helvetica-Bold').fontSize(8).text(d.title === 'RECEIPT' ? 'RECEIVED FROM' : 'BILL TO', 40, y);
    doc.fillColor('#0f172a').font('Helvetica-Bold').fontSize(10).text(d.customer.name, 40, y + 12, { width: W / 2 });
    doc.font('Helvetica').fontSize(9).text(d.customer.lines.filter(Boolean).join('\n'), 40, y + 26, { width: W / 2 });
    d.meta.forEach(([k, v], i) => {
      doc.font('Helvetica-Bold').fontSize(9).fillColor('#64748b').text(k, 40 + W / 2, y + i * 14, { width: W / 4 });
      doc.font('Helvetica').fillColor('#0f172a').text(v, 40 + (3 * W) / 4, y + i * 14, { width: W / 4, align: 'right' });
    });
    y += Math.max(70, d.meta.length * 14 + 10);

    const header = (cols: [string, number, 'left' | 'right'][]) => {
      doc.rect(40, y, W, 20).fill('#e2e8f0');
      doc.fillColor('#0f172a').font('Helvetica-Bold').fontSize(8.5);
      let x = 46;
      for (const [label, w, align] of cols) {
        doc.text(label, x, y + 6, { width: w - 6, align });
        x += w;
      }
      y += 24;
    };
    doc.font('Helvetica').fontSize(9);
    if (d.columns === 'invoice') {
      const cols: [string, number, 'left' | 'right'][] = [
        ['Description', W * 0.52, 'left'],
        ['Qty', W * 0.1, 'right'],
        ['Unit price', W * 0.18, 'right'],
        ['Amount', W * 0.2 - 6, 'right'],
      ];
      header(cols);
      for (const l of d.lines) {
        const h = Math.max(16, doc.heightOfString(l.description, { width: cols[0][1] - 6 }) + 4);
        doc.fillColor('#0f172a').font('Helvetica').fontSize(9);
        doc.text(l.description, 46, y, { width: cols[0][1] - 6 });
        doc.text(l.quantity ?? '', 46 + cols[0][1], y, { width: cols[1][1] - 6, align: 'right' });
        doc.text(l.unitPrice ? money(l.unitPrice) : '', 46 + cols[0][1] + cols[1][1], y, { width: cols[2][1] - 6, align: 'right' });
        doc.text(money(l.amount), 46 + cols[0][1] + cols[1][1] + cols[2][1], y, { width: cols[3][1] - 6, align: 'right' });
        y += h;
        doc.moveTo(40, y - 2).lineTo(40 + W, y - 2).strokeColor('#f1f5f9').stroke();
      }
    } else {
      const cols: [string, number, 'left' | 'right'][] = [
        ['Date', W * 0.14, 'left'],
        ['Description', W * 0.4, 'left'],
        ['Charges', W * 0.15, 'right'],
        ['Payments', W * 0.15, 'right'],
        ['Balance', W * 0.16 - 6, 'right'],
      ];
      header(cols);
      for (const r of d.statementRows ?? []) {
        if (y > doc.page.height - 140) {
          doc.addPage();
          y = 50;
        }
        const vals = [r.date, r.description, r.debit ? money(r.debit) : '', r.credit ? money(r.credit) : '', money(r.balance)];
        let x = 46;
        doc.fillColor('#0f172a').font('Helvetica').fontSize(8.5);
        cols.forEach(([, w, align], i) => {
          doc.text(vals[i], x, y, { width: w - 6, align });
          x += w;
        });
        y += 15;
      }
    }

    y += 8;
    for (const [k, v, strong] of d.totals) {
      doc.font(strong ? 'Helvetica-Bold' : 'Helvetica').fontSize(strong ? 11 : 9.5).fillColor('#0f172a');
      doc.text(k, 40 + W * 0.5, y, { width: W * 0.28 });
      doc.text(v, 40 + W * 0.78, y, { width: W * 0.22 - 6, align: 'right' });
      y += strong ? 18 : 14;
    }

    if (d.stamp) {
      doc.save();
      doc.rotate(-18, { origin: [doc.page.width / 2, 330] });
      doc.fontSize(58).font('Helvetica-Bold').fillColor(d.stamp.color).opacity(0.18).text(d.stamp.text, 0, 300, { width: doc.page.width, align: 'center' });
      doc.restore();
      doc.opacity(1);
    }

    y += 16;
    doc.fillColor('#475569').font('Helvetica').fontSize(8.5);
    for (const n of d.notes) {
      doc.text(n, 40, y, { width: W });
      y = doc.y + 4;
    }
    doc.fontSize(7.5).fillColor('#94a3b8').text(`${d.seller.name} — eQwik YardHRMS™. Payments are made manually (no online payment collection).`, 40, doc.page.height - 50, { width: W, align: 'center' });
    doc.end();
  });
}

export const fmtMoney = (currency: string, v: string) => `${currency} ${money(v)}`;
