# Subscription administration guide (Qwik Licence & Subscription Manager)

For Qwik Business Solutions staff. The Licence Manager is a separate application with its own sign-in
(MFA mandatory). It manages commercial records only — it has **no access to tenant employee, leave,
timesheet or payroll data**.

## Roles

| Role | Can |
|---|---|
| Platform Super Admin | Everything below, plus catalogue (products/plans/features), payment reversal, suspend/revoke/reinstate, code revocation, commercial overrides, staff management, account MFA resets |
| Platform Licensing Officer | Customers, record and verify payments, create/renew subscriptions, change plans and capacity, issue codes, usage, audit |

The owner decision on payment controls is implemented as `PAYMENT_REQUIRE_SEPARATE_VERIFIER` (default
`true`): the person who records a payment cannot verify it.

## Catalogue

*Products* and *Plans*. A plan has code, name, Free flag, optional price and currency, duration in months,
employee limit, user limit, grace days, status and features (EMPLOYEES, LEAVE, TIMESHEETS, OVERTIME,
PAYROLL, PAYSLIPS, BULK_IMPORT, ADVANCED_REPORTS, AUDIT_VIEW). Seed plans (Free 5/2, Starter 25/5,
Professional 100/15, Business 250/30) carry **proposed** annual prices (J$95,000 / J$295,000 /
J$595,000, GCT-exclusive — see [pricing](pricing.md)) until the owner confirms or changes them. Changing a plan affects subscriptions on it from the next entitlement check; it never deletes
tenant data. Retire plans rather than deleting them.

## Customers

A customer is the commercial party (name, contact, email, phone, address, TRN, notes), optionally linked
to a tenant (company workspace). Companies that self-register get a tenant and a Free subscription
automatically; create or link the customer record when they start buying.

## Manual payments (no online payments)

1. **Record** (*Payments → Record payment*): customer, plan (optional), invoice/receipt number,
   reference, payment date, amount, currency, method (cash, bank transfer, cheque, other), covered period,
   notes. Attach evidence (PDF/image: bank slip, receipt) — stored privately.
2. **Verify** (a different officer when the separate-verifier rule is on) after checking the money
   arrived. Or **Reject** with a reason.
3. A verified payment can be used **once** — to create, activate or renew a subscription. A verified
   payment can be **reversed** by a Super Admin (e.g. bounced cheque) with a reason; the subscription it
   funded gets a PAYMENT_REVERSED history event but is not changed automatically — suspend it if
   appropriate.

Every state change is kept in the payment's event history with actor, time and reason.

## Subscriptions

**Create** (*Subscriptions → New subscription*): customer, plan, the verified payment, optional capacity
overrides, then either:

- **Issue an activation code** — the subscription waits in PENDING_ACTIVATION until the company's
  administrator enters the code under *Subscription* in YardHRMS; or
- **Apply directly to the linked tenant** — activates immediately.

Without a verified payment, only a Super Admin can proceed, using a **commercial override** with a
written reason (≥ 10 characters) — recorded in the audit log.

The paid period starts at activation and lasts the plan's duration; the grace period follows it.

**States**

| State | Meaning for the company |
|---|---|
| FREE | Free plan limits and features |
| PENDING_ACTIVATION | Paid plan bought, code not yet redeemed (company stays on its current plan) |
| TRIAL / ACTIVE | Full plan features and limits |
| GRACE | Paid period ended; still writable for the grace days, with a warning banner |
| EXPIRED | Read-only: view and export everything, no changes, until renewed |
| SUSPENDED | Read-only (e.g. dispute, reversed payment), reversible by reinstating |
| REVOKED | Access blocked except the subscription page; data retained; reinstate to restore |

The worker sweeps every 15 minutes: ACTIVE → GRACE → EXPIRED, and expires unredeemed codes. **No state
ever deletes tenant data.**

**Renew** — record and verify the renewal payment, then *Renew* on the subscription: the end date is
extended from the current end (or from today if already expired) by the chosen months. **No new code is
needed.** Each payment can fund only one renewal.

**Change plan** (upgrade/downgrade, with reason) and **Adjust capacity** (employee/user limit overrides,
with reason). Downgrades below current usage do not remove anything; the company simply cannot add or
reactivate beyond the new limit.

**Suspend / Revoke / Reinstate** — Super Admin, with reason.

## Activation codes

- Generated from a cryptographically secure random source, shown **once** in a dialog — copy it and send
  it to the customer's administrator through a trusted channel. Only a one-way hash is stored; nobody can
  view it again (issue a new one if lost, and revoke the old).
- Single use, expire after the chosen number of days (default 30, maximum 180), bound to the
  subscription's company: a code redeemed by one company is rejected for every other company, and
  concurrent redemption attempts cannot double-activate.
- *Codes* lists issued/redeemed/expired/revoked codes with timestamps (never the code itself).

## Renewals, usage and audit

- *Renewals*: subscriptions expiring in the next 30 days, in grace, or expired — the follow-up queue for
  account managers. Company administrators are reminded automatically 30, 14, 7 and 1 day(s) before
  expiry and when grace starts or the subscription expires.
- *Usage*: active employees and users against limits per company — counts only, no personal data.
- *Audit*: platform actions (payments, subscriptions, codes, overrides, staff, MFA resets) and
  subscription events. Tenant HR/payroll audit detail is not shown here.

## Staff and accounts

*Settings*: add staff (they receive a password-setup link and must enrol MFA), remove platform access
(at least one Super Admin must remain). *Reset an account's MFA* is for a company's only administrator or
a staff member who lost their authenticator: verify identity out of band first and record how; the person
is signed out everywhere and notified by email.

## Legacy licences

Customers moving from the Apps Script edition: legacy InstallationIDs and `LOCAL_FREE` caches are not
used. The migration tool's reconciliation report lists each legacy licence with the matched company and
the recommended action; activate paid plans only through the normal payment → subscription flow above.

## Invoices, receipts and statements

- *Invoices → New invoice*: choose the customer and either a plan (uses the plan price) or enter lines.
  Numbers run INV-YYYY-00001… without gaps. GCT is added only when `BILLING_GCT_RATE` is set (Qwik must be
  GCT-registered). A paid invoice cannot be voided; void others with a reason (the number is never reused).
- Record the payment with the invoice number; when a different officer verifies it, the invoice becomes
  PAID. Reversing the payment reopens the invoice.
- *Receipt PDF* on a verified payment issues receipt RCT-YYYY-00001… once; later downloads show the same
  receipt, marked REVERSED if the payment is reversed.
- *Statement* on a customer gives the year to date: opening balance, invoices, payments, reversals and the
  running balance. Companies see their own invoices, receipts and statement on their Subscription page.

## Account closures and legal holds

*Closures & Legal Holds* (Super Admin) lists closure requests from companies. Confirm the request with the
company's director through a known contact and check for disputes or unpaid invoices before approving.
Closure executes after the 30-day cooling-off period. *Legal hold* (with a reason) stops all retention
deletion and closure for that company until lifted — use it for litigation, audits or investigations.
