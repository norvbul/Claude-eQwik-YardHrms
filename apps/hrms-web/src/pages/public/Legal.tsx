import { RETENTION_RULES } from '@yardhrms/types';
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';

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
      <p>
        The full contractual terms are in the <Link to="/terms">Terms of Service</Link>; personal data handling is described in the <Link to="/privacy">Privacy Notice</Link>.
      </p>
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
      <p>eQwik YardHRMS™ is published by Qwik Business Solutions™.</p>
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

const DRAFT_NOTE = 'Version 1.0 draft, 13 October 2026 — prepared for review by Qwik Business Solutions’ legal adviser before publication.';

export function Terms() {
  return (
    <LegalPage title="Terms of Service" updated={DRAFT_NOTE}>
      <p>
        These terms govern the use of eQwik YardHRMS™ (the “Service”), provided by <strong>Qwik Business Solutions™</strong> (“Qwik”, “we”) to the organization that registers a workspace (the “Customer”) and the
        people the Customer authorizes to use it (“Users”). By registering or using the Service you accept these terms on behalf of the Customer.
      </p>
      <h2>1. The Service and plans</h2>
      <ul>
        <li>The Free plan is provided without charge with the limits shown at sign-up. Paid plans add features and capacity for the term purchased.</li>
        <li>Plan prices, limits and features are published on our website and may change for future terms; a change never applies to a term already paid.</li>
        <li>Paid plans are paid manually (bank transfer, cash or cheque) against our invoice. The Service does not collect card or online payments.</li>
        <li>A paid plan is activated with a one-time authorization code or applied directly by Qwik after we verify payment. Renewals extend the current subscription without a new code.</li>
      </ul>
      <h2>2. Expiry, grace and read-only access</h2>
      <p>
        When a paid term ends, the plan’s grace period applies. After it, the workspace becomes read-only: Users can view and export their data but cannot make changes until the subscription is renewed. Expiry never
        deletes Customer data.
      </p>
      <h2>3. Customer responsibilities</h2>
      <ul>
        <li>Keep User credentials confidential, use multi-factor authentication where required, and remove access for people who leave.</li>
        <li>
          <strong>Payroll configuration:</strong> statutory rates, thresholds and ceilings are configuration the Customer approves. Reference packs we provide are a starting point; the Customer must verify them against
          current Jamaican law and Tax Administration Jamaica, NIS, NHT and HEART/NSTA guidance (with a qualified payroll specialist) before paying employees. The Customer remains responsible for statutory filings and
          remittances.
        </li>
        <li>Collect and process employee personal data lawfully, including giving employees the privacy information required by the Data Protection Act, 2020.</li>
        <li>Do not upload unlawful content or malware, attempt to access other customers’ data, probe or overload the Service, or circumvent licence or capacity controls.</li>
      </ul>
      <h2>4. Customer data</h2>
      <p>
        The Customer owns its data and is the data controller for its employees’ personal data; Qwik processes it on the Customer’s behalf only to provide the Service, as described in our <Link to="/privacy">Privacy Notice</Link>.
        The Customer can export all of its data at any time, including while read-only. Data is retained and deleted according to the retention schedule in the Privacy Notice and the Customer’s retention settings.
      </p>
      <h2>5. Closing an account</h2>
      <p>
        A Company Administrator may request closure from Company Settings. After a 30-day cooling-off period and our confirmation, access ends and data not required by law is erased. Payroll records that must be
        kept by law are retained securely, inaccessible to the Customer, until their retention period ends and are then deleted automatically. We may suspend or close a workspace for non-payment beyond the grace
        period, breach of these terms or where required by law, giving notice where we lawfully can.
      </p>
      <h2>6. Availability and support</h2>
      <p>We aim for high availability and announce planned maintenance in advance, but the Service is provided without a guaranteed service level unless agreed in writing.</p>
      <h2>7. Liability</h2>
      <p>
        To the extent permitted by law, Qwik is not liable for indirect or consequential loss, or for losses arising from statutory configuration the Customer approved, and our total liability in any 12-month period is
        limited to the fees the Customer paid for the Service in that period. Nothing limits liability that cannot be limited by law.
      </p>
      <h2>8. Changes and governing law</h2>
      <p>
        We may update these terms with at least 30 days’ notice for material changes. These terms are governed by the laws of Jamaica and the courts of Jamaica have jurisdiction. Contact: Qwik Business Solutions™,
        via the details on our website.
      </p>
    </LegalPage>
  );
}

export function Privacy() {
  return (
    <LegalPage title="Privacy Notice" updated={DRAFT_NOTE}>
      <p>
        This notice explains how personal data is handled in eQwik YardHRMS™ under the <strong>Data Protection Act, 2020 (Jamaica)</strong>.
      </p>
      <h2>Who is responsible</h2>
      <ul>
        <li>
          <strong>Employee and HR data</strong> entered by an employer (names, contact details, TRN, NIS and NHT numbers, bank accounts, pay, leave, time and documents): the <em>employer</em> is the data controller. Qwik
          Business Solutions™ processes this data on the employer’s instructions to provide the service.
        </li>
        <li>
          <strong>Account and billing data</strong> (user names, emails, sign-in records, customer contacts, invoices and payments): Qwik Business Solutions™ is the data controller.
        </li>
      </ul>
      <h2>What we use it for</h2>
      <ul>
        <li>Providing HR and payroll administration: employee records, leave, timesheets, overtime, payroll, payslips and statutory reporting.</li>
        <li>Security: authentication, multi-factor verification, fraud and abuse prevention, and audit trails.</li>
        <li>Service communications: verification, approvals, payslip availability and subscription notices.</li>
        <li>Billing and subscription management, and meeting legal obligations such as tax record-keeping.</li>
      </ul>
      <p>We do not sell personal data or use employee data for advertising.</p>
      <h2>Who receives it</h2>
      <p>
        Authorized users of the employer’s workspace according to their roles; the hosting, storage and email providers we use to run the service, under contract and security obligations; and authorities where the
        law requires. Qwik staff do not have access to employee payroll records through the licensing tools. If data is stored or processed outside Jamaica, we use providers with appropriate safeguards as required
        by the Act.
      </p>
      <h2>How it is protected</h2>
      <p>
        Encryption in transit; field-level encryption of TRN, NIS, NHT and bank account numbers; private file storage; role-based access with multi-factor authentication for privileged roles; immutable audit logs;
        and backups.
      </p>
      <h2>How long it is kept</h2>
      <p>Default retention periods (an employer may lengthen them, but not shorten them below the legal minimums):</p>
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="text-xs uppercase text-slate-500">
            <th className="py-1 pr-3">Records</th>
            <th className="py-1 pr-3">Kept for</th>
            <th className="py-1">Reason</th>
          </tr>
        </thead>
        <tbody>
          {RETENTION_RULES.map((r) => (
            <tr key={r.key} className="border-t border-slate-100 align-top">
              <td className="py-1 pr-3">{r.label}</td>
              <td className="py-1 pr-3">
                {r.defaultValue} {r.unit} from {r.from}
              </td>
              <td className="py-1 text-slate-500">{r.basis}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p>Sign-in history and expired sessions are kept for 12 months; data export files for 7 days. Data under a legal hold is kept until the hold ends.</p>
      <h2>Your rights</h2>
      <p>
        You may ask for access to your personal data, ask for inaccurate data to be corrected, object to or ask us to stop processing that causes unwarranted damage or distress, and ask about automated decisions.
        Employees should contact their employer first, as controller of their HR data; we will help the employer respond. You may also complain to the <strong>Office of the Information Commissioner</strong> of Jamaica.
      </p>
      <h2>Contact</h2>
      <p>Qwik Business Solutions™ — Data Protection Officer, via the contact details on our website.</p>
    </LegalPage>
  );
}
