import type { ReactNode } from 'react';

function LegalPage({ title, updated, children }: { title: string; updated?: string; children: ReactNode }) {
  return (
    <article className="mx-auto max-w-3xl px-4 py-14">
      <h1 className="text-3xl font-bold tracking-tight text-slate-900">{title}</h1>
      {updated && <p className="mt-1 text-sm text-slate-500">{updated}</p>}
      <div className="prose-sm mt-8 space-y-4 text-slate-700 [&_h2]:mt-8 [&_h2]:text-lg [&_h2]:font-semibold [&_h2]:text-slate-900 [&_li]:ml-5 [&_li]:list-disc">{children}</div>
    </article>
  );
}

export function About() {
  return (
    <LegalPage title="About eQwik YardHRMS™">
      <p>
        eQwik YardHRMS™ is a cloud-hosted, subscription-based Human Resource Management and Payroll platform designed primarily for Jamaican businesses. It is owned, developed and published by{' '}
        <strong>Qwik Business Solutions™</strong>.
      </p>
      <h2>What it does</h2>
      <ul>
        <li>Employee records, compensation, banking details, documents and employment history</li>
        <li>Leave policies, requests, approvals, balances and accruals</li>
        <li>Weekly and fortnightly timesheets and a separate overtime approval process</li>
        <li>Weekly, fortnightly and monthly payroll with effective-dated statutory configuration</li>
        <li>Payslips, bank upload files and statutory, departmental and HR reports</li>
        <li>Bulk Excel/CSV imports, employee self-service and role-based access</li>
      </ul>
      <h2>Subscriptions</h2>
      <p>
        Every company receives a Free plan at registration. Paid plans are purchased directly from Qwik Business Solutions; payments are verified manually and activated using a one-time authorization code entered on the
        Subscription page.
      </p>
      <h2>Contact</h2>
      <p>For sales, support and licensing enquiries, contact Qwik Business Solutions™. (Contact details to be published by the product owner.)</p>
    </LegalPage>
  );
}

export function Licence() {
  return (
    <LegalPage title="Licence" updated="Draft — subject to owner and legal approval">
      <p>
        eQwik YardHRMS™ is licensed, not sold. Access is granted to subscribing organizations under a subscription with Qwik Business Solutions™. The scope of each subscription — features, number of active employees and
        number of active users, and its term — is defined by the plan and any written agreement.
      </p>
      <h2>Permitted use</h2>
      <ul>
        <li>Use by the subscribing organization’s authorized users for its own HR and payroll administration.</li>
        <li>Export of the organization’s own data, including after a subscription expires (read-only access).</li>
      </ul>
      <h2>Restrictions</h2>
      <ul>
        <li>No reverse engineering, resale, sublicensing or circumvention of licence or capacity controls.</li>
        <li>No sharing of user accounts; each user requires their own credentials.</li>
      </ul>
      <h2>Expiry</h2>
      <p>After expiry and any grace period the workspace becomes read-only. Data is never automatically deleted because a subscription expires.</p>
      <p className="text-sm text-slate-500">Final customer-facing licence terms must be confirmed by Qwik Business Solutions (PRD §17).</p>
    </LegalPage>
  );
}

export function Disclaimer() {
  return (
    <LegalPage title="Disclaimer & payroll compliance notice">
      <p>
        <strong>Statutory payroll deductions</strong> (including PAYE, NIS, NHT, Education Tax and employer contributions) are calculated from rates, thresholds and ceilings that are entered and approved as effective-dated
        configuration. eQwik YardHRMS™ does not ship pre-verified statutory rates.
      </p>
      <p>
        Each organization is responsible for verifying its statutory configuration against current Jamaican law, Tax Administration Jamaica, NIS and NHT notices and applicable employment agreements, with a qualified
        payroll specialist, before processing live payroll.
      </p>
      <p>
        Until the platform’s statutory rules package and reference calculations have been signed off, payslips and payroll reports display a <em>“Not certified for live payroll”</em> notice.
      </p>
      <h2>General</h2>
      <p>The software is provided to assist with HR administration and does not constitute legal, tax or accounting advice.</p>
    </LegalPage>
  );
}

export function Copyright() {
  return (
    <LegalPage title="Copyright">
      <p>© {new Date().getFullYear()} Qwik Business Solutions™. All rights reserved.</p>
      <p>eQwik YardHRMS™ and Qwik Business Solutions™ are used as product and company marks of Qwik Business Solutions.</p>
      <p>Company names, logos and data displayed within a customer workspace belong to the respective customer organization.</p>
    </LegalPage>
  );
}
