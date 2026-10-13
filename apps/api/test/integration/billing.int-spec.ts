import { TestContext, bootstrap, createPlatformStaff, registerTenant, uniq } from './helpers';

const pdfBody = (c: any, path: string) =>
  c.agent
    .get(`/api/v1${path}`)
    .buffer(true)
    .parse((res: any, cb: any) => {
      const chunks: Buffer[] = [];
      res.on('data', (x: Buffer) => chunks.push(x));
      res.on('end', () => cb(null, Buffer.concat(chunks)));
    });

describe('Billing documents (LIC-014)', () => {
  let ctx: TestContext;
  beforeAll(async () => {
    ctx = await bootstrap();
  });
  afterAll(async () => {
    await ctx.app.close();
  });

  it('invoices are numbered gap-free, settle when their payment is verified, and reverse back; receipts and statements render', async () => {
    const t = await registerTenant(ctx);
    const officer = await createPlatformStaff(ctx, 'PLATFORM_LICENSING_OFFICER');
    const sup = await createPlatformStaff(ctx, 'PLATFORM_SUPER_ADMIN');
    await officer.client.refreshCsrf();
    await sup.client.refreshCsrf();
    const customer = await ctx.prisma.customer.findUniqueOrThrow({ where: { tenantId: t.tenantId } });
    const plan = await ctx.prisma.plan.findUniqueOrThrow({ where: { code: 'STARTER' } });

    if (!plan.price) {
      const unpriced = await officer.client.post('/platform/invoices', { customerId: customer.id, planId: plan.id });
      expect(unpriced.status).toBe(422);
    }
    const inv = await officer.client.post('/platform/invoices', { customerId: customer.id, lines: [{ description: 'Starter subscription — 12 months', quantity: 1, unitPrice: '95000.00' }, { description: 'Onboarding session', quantity: 2, unitPrice: '5000' }] });
    expect(inv.status).toBe(201);
    expect(inv.body.data).toMatchObject({ subtotal: '105000.00', total: '105000.00', status: 'ISSUED' });
    expect(inv.body.data.number).toMatch(/^INV-\d{4}-\d{5}$/);
    const inv2 = await officer.client.post('/platform/invoices', { customerId: customer.id, lines: [{ description: 'Extra', unitPrice: '100' }] });
    const n1 = Number(inv.body.data.number.slice(-5));
    expect(Number(inv2.body.data.number.slice(-5))).toBe(n1 + 1);

    const pdf = await pdfBody(officer.client, `/platform/invoices/${inv.body.data.id}/pdf`);
    expect(pdf.status).toBe(200);
    expect((pdf.body as Buffer).subarray(0, 4).toString()).toBe('%PDF');

    // Payment quoting the invoice number settles it once verified (by a different officer)
    const pay = await officer.client.post('/platform/payments', { customerId: customer.id, invoiceNumber: inv.body.data.number.toLowerCase(), reference: uniq('BNS'), paymentDate: '2026-02-01', amount: '105000.00', currency: 'JMD', method: 'BANK_TRANSFER' });
    expect(pay.status).toBe(201);
    expect((await officer.client.get(`/platform/payments/${pay.body.data.id}/receipt`)).status).toBe(422); // not verified yet
    expect((await sup.client.post(`/platform/payments/${pay.body.data.id}/verify`, {})).status).toBe(200);
    expect((await ctx.prisma.invoice.findUniqueOrThrow({ where: { id: inv.body.data.id } })).status).toBe('PAID');
    const rct = await pdfBody(officer.client, `/platform/payments/${pay.body.data.id}/receipt`);
    expect(rct.status).toBe(200);
    const receipt = await ctx.prisma.receipt.findUniqueOrThrow({ where: { paymentId: pay.body.data.id } });
    expect(receipt.number).toMatch(/^RCT-\d{4}-\d{5}$/);
    await pdfBody(officer.client, `/platform/payments/${pay.body.data.id}/receipt`);
    expect(await ctx.prisma.receipt.count({ where: { paymentId: pay.body.data.id } })).toBe(1); // same receipt on re-download

    expect((await officer.client.post(`/platform/invoices/${inv.body.data.id}/void`, { reason: 'Mistake' })).status).toBe(403); // reverse permission
    expect((await sup.client.post(`/platform/invoices/${inv.body.data.id}/void`, { reason: 'Mistake' })).status).toBe(409); // paid
    expect((await sup.client.post(`/platform/payments/${pay.body.data.id}/reverse`, { reason: 'Cheque bounced' })).status).toBe(200);
    expect((await ctx.prisma.invoice.findUniqueOrThrow({ where: { id: inv.body.data.id } })).status).toBe('ISSUED');
    expect((await sup.client.post(`/platform/invoices/${inv2.body.data.id}/void`, { reason: 'Raised in error' })).status).toBe(200);

    const st = await pdfBody(officer.client, `/platform/customers/${customer.id}/statement?from=2026-01-01&to=2026-12-31`);
    expect(st.status).toBe(200);
    expect((await officer.client.get(`/platform/customers/${customer.id}/statement?from=bad&to=2026-12-31`)).status).toBe(400);

    // The company sees only its own documents
    const docs = await t.admin.get('/subscription/billing');
    expect(docs.status).toBe(200);
    expect(docs.body.data.invoices.map((i: any) => i.number)).toEqual(expect.arrayContaining([inv.body.data.number, inv2.body.data.number]));
    expect(docs.body.data.receipts[0]).toMatchObject({ number: receipt.number, status: 'REVERSED' });
    expect((await pdfBody(t.admin, `/subscription/billing/invoices/${inv.body.data.id}/pdf`)).status).toBe(200);
    const other = await registerTenant(ctx);
    expect((await other.admin.get(`/subscription/billing/invoices/${inv.body.data.id}/pdf`)).status).toBe(404);
  });
});
