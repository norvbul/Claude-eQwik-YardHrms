import { Button } from '@yardhrms/ui';
import { BadgeCheck, CalendarDays, Clock, FileSpreadsheet, Lock, Receipt, ShieldCheck, Users, Wallet } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';

const features = [
  { icon: Users, title: 'Employee records', text: 'Profiles, TRN/NIS/NHT identifiers, compensation history, documents and emergency contacts — encrypted and permission-controlled.' },
  { icon: CalendarDays, title: 'Leave management', text: 'Vacation, sick, maternity and company-defined leave with balances, accruals, carry-forward and public-holiday aware working days.' },
  { icon: Clock, title: 'Timesheets & overtime', text: 'Weekly and fortnightly timesheets, separate overtime approvals and delegated entry with full audit attribution.' },
  { icon: Wallet, title: 'Jamaican payroll', text: 'Weekly, fortnightly and monthly payroll with effective-dated, versioned PAYE, NIS, NHT and Education Tax configuration.' },
  { icon: Receipt, title: 'Payslips & bank files', text: 'Secure PDF payslips, controlled bank upload files and statutory and departmental reports.' },
  { icon: FileSpreadsheet, title: 'Bulk imports', text: 'Excel/CSV templates with preview, validation, duplicate detection and row-level results.' },
];

export function Landing() {
  return (
    <>
      <section className="relative overflow-hidden bg-gradient-to-br from-[#062b1d] via-[#0b5d3b] to-[#0e7a4d] text-white">
        <div className="absolute -right-24 -top-24 h-96 w-96 rounded-full bg-accent/20 blur-3xl" aria-hidden />
        <div className="relative mx-auto grid max-w-6xl items-center gap-10 px-4 py-20 md:grid-cols-2">
          <div>
            <span className="inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1 text-xs font-medium text-emerald-50 ring-1 ring-white/20">
              <BadgeCheck className="h-3.5 w-3.5 text-accent" /> Built for Jamaican businesses
            </span>
            <h1 className="mt-5 text-4xl font-bold tracking-tight sm:text-5xl">HR & payroll, done the Yard way.</h1>
            <p className="mt-4 max-w-xl text-lg text-emerald-50/85">
              eQwik YardHRMS™ brings people records, leave, timesheets, overtime and payroll together in one secure cloud platform — from a five-person shop to a growing enterprise.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link to="/register">
                <Button variant="accent" size="lg">
                  Start Free — no card needed
                </Button>
              </Link>
              <Link to="/login" className="inline-flex h-12 items-center rounded-lg border border-white/40 px-6 text-base font-medium text-white transition-colors hover:bg-white/10">
                Sign in
              </Link>
            </div>
            <p className="mt-4 text-sm text-emerald-50/70">Free plan: up to 5 employees and 2 users. Upgrade any time with an activation code from Qwik Business Solutions.</p>
          </div>
          <div className="hidden md:block">
            <div className="rounded-2xl bg-white p-5 text-slate-900 shadow-2xl">
              <div className="flex items-center justify-between">
                <p className="text-sm font-semibold">Payroll run · Monthly</p>
                <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700 ring-1 ring-emerald-200">Approved</span>
              </div>
              <div className="mt-4 grid grid-cols-3 gap-3 text-center">
                {[
                  ['Gross', '4.2M'],
                  ['Statutory', '0.9M'],
                  ['Net', '3.3M'],
                ].map(([k, v]) => (
                  <div key={k} className="rounded-xl bg-slate-50 p-3">
                    <p className="text-xs text-slate-500">{k}</p>
                    <p className="text-lg font-semibold">JMD {v}</p>
                  </div>
                ))}
              </div>
              <div className="mt-4 space-y-2">
                {['Draft', 'Prepared', 'Reviewed', 'Approved', 'Locked'].map((s, i) => (
                  <div key={s} className="flex items-center gap-3 text-sm">
                    <span className={`grid h-6 w-6 place-items-center rounded-full text-xs font-bold ${i < 4 ? 'bg-brand text-white' : 'bg-slate-100 text-slate-400'}`}>{i + 1}</span>
                    {s}
                  </div>
                ))}
              </div>
              <p className="mt-4 text-xs text-slate-400">Illustrative example</p>
            </div>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4 py-16">
        <h2 className="text-center text-3xl font-bold tracking-tight">Everything your HR and payroll team needs</h2>
        <p className="mx-auto mt-3 max-w-2xl text-center text-slate-600">Role-based access for administrators, HR, payroll, finance, managers and employees — with self-service for every staff member.</p>
        <div className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {features.map((f) => (
            <div key={f.title} className="rounded-2xl border border-slate-200 p-6 shadow-sm transition-shadow hover:shadow-md">
              <div className="grid h-11 w-11 place-items-center rounded-xl bg-brand/10 text-brand">
                <f.icon className="h-5 w-5" />
              </div>
              <h3 className="mt-4 font-semibold">{f.title}</h3>
              <p className="mt-1 text-sm text-slate-600">{f.text}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="bg-slate-50">
        <div className="mx-auto grid max-w-6xl gap-8 px-4 py-16 md:grid-cols-3">
          {[
            { icon: ShieldCheck, title: 'Secure by design', text: 'Multi-factor authentication, encrypted identifiers and bank details, strict tenant isolation and immutable audit trails.' },
            { icon: Lock, title: 'Locked, auditable payroll', text: 'Approved payroll is frozen as an immutable snapshot. Corrections use controlled reversals — never silent edits.' },
            { icon: BadgeCheck, title: 'Compliance-first configuration', text: 'Statutory rates are effective-dated configuration that must be verified and approved before use.' },
          ].map((b) => (
            <div key={b.title}>
              <b.icon className="h-6 w-6 text-brand" />
              <h3 className="mt-3 font-semibold">{b.title}</h3>
              <p className="mt-1 text-sm text-slate-600">{b.text}</p>
            </div>
          ))}
        </div>
      </section>

      <Pricing />

      <section className="mx-auto max-w-6xl px-4 py-16">
        <h2 className="text-center text-2xl font-bold">What customers say</h2>
        <div className="mt-8 grid gap-5 md:grid-cols-3">
          {[1, 2, 3].map((i) => (
            <figure key={i} className="rounded-2xl border border-dashed border-slate-300 p-6 text-sm text-slate-500">
              <blockquote>“Customer testimonial placeholder — to be supplied by Qwik Business Solutions.”</blockquote>
              <figcaption className="mt-3 font-medium text-slate-400">Customer name, Company</figcaption>
            </figure>
          ))}
        </div>
        <div className="mt-12 rounded-2xl bg-brand px-6 py-10 text-center text-white">
          <h3 className="text-2xl font-bold">Ready to get started?</h3>
          <p className="mt-2 text-emerald-50/85">Create your company workspace in minutes. Paid plans are activated with a Qwik authorization code.</p>
          <Link to="/register">
            <Button variant="accent" size="lg" className="mt-6">
              Start Free
            </Button>
          </Link>
        </div>
      </section>
    </>
  );
}

interface PublicPlan {
  code: string;
  name: string;
  isFree: boolean;
  price: string | null;
  currency: string;
  durationMonths: number | null;
  employeeLimit: number;
  userLimit: number;
  features: string[];
}

/** Prices come from the Licence Manager (editable by Qwik); nothing is hardcoded here. */
function Pricing() {
  const [plans, setPlans] = useState<PublicPlan[] | null>(null);
  useEffect(() => {
    let alive = true;
    fetch('/api/v1/subscription/public-plans')
      .then((r) => (r.ok ? r.json() : null))
      .then((b) => alive && b?.data && setPlans(b.data))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);
  if (!plans?.length) return null;
  const fmt = (v: string, c: string) => `${c} ${Number(v).toLocaleString('en-JM', { maximumFractionDigits: 0 })}`;
  return (
    <section id="pricing" className="bg-slate-50 py-16">
      <div className="mx-auto max-w-6xl px-4">
        <h2 className="text-center text-2xl font-bold">Simple, transparent pricing</h2>
        <p className="mt-2 text-center text-sm text-slate-500">Prices exclude GCT where applicable. Paid plans are billed annually and paid by bank transfer, cash or cheque.</p>
        <div className="mt-8 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {plans.map((p) => (
            <div key={p.code} className={`flex flex-col rounded-2xl border bg-white p-6 ${p.code === 'PROFESSIONAL' ? 'border-brand shadow-lg' : 'border-slate-200'}`}>
              <h3 className="text-lg font-semibold">{p.name}</h3>
              <p className="mt-3 text-3xl font-bold text-slate-900">
                {p.isFree ? 'Free' : p.price ? fmt(p.price, p.currency) : 'Contact us'}
                {!p.isFree && p.price && <span className="text-sm font-medium text-slate-500"> / {p.durationMonths === 12 || !p.durationMonths ? 'year' : `${p.durationMonths} months`}</span>}
              </p>
              <p className="mt-1 text-sm text-slate-500">
                Up to {p.employeeLimit} employees · {p.userLimit} users
              </p>
              <ul className="mt-4 flex-1 space-y-1 text-sm text-slate-600">
                {p.features.map((f) => (
                  <li key={f}>✓ {f}</li>
                ))}
              </ul>
              <Link to="/register" className="mt-6 inline-flex justify-center rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white hover:bg-brand/90">
                {p.isFree ? 'Start Free' : 'Start free, upgrade later'}
              </Link>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
