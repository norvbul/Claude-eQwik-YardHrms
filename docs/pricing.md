# Pricing proposal

Status: **proposal for owner approval** (PRD §17). Prices are data, not code: they are seeded only into plans
whose price has never been set and are fully editable in the Licence Manager (*Plans & Features*). The
landing page and the tenant Subscription page read them from the API.

## Proposed plans (annual, JMD, excluding GCT)

| Plan | Employees | Users | Features | Price / year | ≈ per month | ≈ per employee / month at the limit |
|---|---|---|---|---|---|---|
| Free | 5 | 2 | Employees, leave, timesheets | J$0 | — | — |
| Starter | 25 | 5 | + overtime, payroll, payslips | **J$95,000** | J$7,917 | J$317 |
| Professional | 100 | 15 | + bulk import, advanced reports, audit log | **J$295,000** | J$24,583 | J$246 |
| Business | 250 | 30 | All features | **J$595,000** | J$49,583 | J$198 |

Grace periods: Starter/Professional 14 days, Business 30 days. Prices exclude GCT; GCT is added on invoices
only if Qwik is GCT-registered (`BILLING_GCT_RATE`, `BILLING_GCT_NUMBER`).

## Market reference (researched 13 October 2026)

| Offering | Published price | Notes |
|---|---|---|
| Payroll-Jam (local) | Starter J$5,000/month; Pro J$10,000/month + J$500 per employee; free micro tier | JMD pricing; Pro for 25 employees ≈ J$22,500/month |
| Workzoom (regional SaaS) | ≈ US$14 per employee/month (all modules), US$4 per module | ≈ J$2,200 per employee/month |
| Deel (international) | ≈ US$29 per employee/month | Limited Jamaica-specific compliance |
| Local outsourced payroll bureaus | reported ≈ J$150,000–200,000 (period unclear) | Service, not software |

Sources: [Payroll-Jam](https://www.payrolljam.com/), [Workzoom Jamaica](https://www.workzoom.com/country/jamaica/),
[Headoffice — best payroll software Jamaica 2026](https://headoffice.app/jamaica/blog/best-payroll-software-jamaica-2026),
[Neo — top payroll providers in Jamaica 2026](https://joinneo.com/the-top-9-local-payroll-processing-providers-in-jamaica-reviewed-in-2026/).
Vendor prices change; verify before relying on them.

## Rationale

- **Below international per-seat tools, competitive with local software:** Starter is about a third of
  Payroll-Jam Pro at 25 employees while including HR, leave and time; Professional/Business decline per
  employee to reward growth.
- **Annual billing** fits manual payment verification (one payment, one renewal per year) and keeps
  collection effort low; monthly terms can be added as separate plans (duration 1 month) if demand exists.
- **Free tier** (5 employees) supports micro-businesses and lets companies start before buying.

## Open decisions for the owner

1. Approve or change the four prices and whether to offer monthly terms or multi-year discounts.
2. GCT registration status (determines whether invoices add GCT at the standard rate).
3. Onboarding/migration services pricing (legacy data migration is a managed engagement).
