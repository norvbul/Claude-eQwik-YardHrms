import type { StatutoryComponentDef } from '../types';

/**
 * Jamaica statutory payroll REFERENCE PACKS.
 *
 * These are researched figures offered as a starting point. They are NOT used by the engine directly:
 * importing a pack creates a DRAFT statutory rule version in a tenant, which a second authorised person
 * must check against Tax Administration Jamaica (TAJ), NIS, NHT and HEART/NSTA publications and approve
 * with an attestation. Live payroll additionally requires PAYROLL_COMPLIANCE_CERTIFIED (specialist sign-off).
 *
 * Research date: 2026-10-13. Government sites could not be fetched directly from the build environment;
 * figures are those consistently reported from TAJ / JIS releases by the sources listed below.
 */
export interface ReferenceSource {
  title: string;
  url: string;
}

export interface ReferencePack {
  key: string;
  name: string;
  effectiveFrom: string;
  /** Effective-to of the pack itself (the next pack starts the following day); null = open. */
  effectiveTo: string | null;
  researchedOn: string;
  sources: ReferenceSource[];
  /** Points the reviewer must confirm before approving. */
  verify: string[];
  components: (StatutoryComponentDef & { notes: string })[];
}

const SOURCES: ReferenceSource[] = [
  { title: 'JIS — Increase in Income Tax Threshold Now in Effect (April 2026)', url: 'https://jis.gov.jm/increase-in-income-tax-threshold-now-in-effect/' },
  { title: 'TAJ Technical Advisory 042025/01/IT-TA — revised income tax threshold', url: 'https://www.jamaicatax.gov.jm/documents/10194/52231399/Technical_Advisory_Threshold+_042025.pdf' },
  { title: 'TAJ — Payroll Taxes and Statutory Contributions (Employee/Employer)', url: 'https://www.jamaicatax.gov.jm/documents/10194/53547865/Payroll+Taxes+and+Statutory+Contributions+(Employee+Employer).pdf' },
  { title: 'TAJ — Education Tax information sheet', url: 'https://www.jamaicatax.gov.jm/documents/10181/106865/EDUCATION+TAX+Info+(FINAL_Feb2018).pdf' },
  { title: 'NHT — Employee contribution', url: 'https://www.nht.gov.jm/employee-contribution' },
  { title: 'JIS — NIS safeguarding Jamaicans with vital social protection (6% rate, J$5M ceiling)', url: 'https://jis.gov.jm/features/nis-safeguarding-jamaicans-with-vital-social-protection/' },
  { title: 'HEART/NSTA Trust — Contributions', url: 'https://www.heart-nsta.org/contributions/' },
  { title: 'PwC Worldwide Tax Summaries — Jamaica, other taxes', url: 'https://taxsummaries.pwc.com/jamaica/individual/other-taxes' },
];

const VERIFY = [
  'Income tax threshold and the J$6,000,000 band boundary for the effective date (TAJ technical advisory).',
  'PAYE method: TAJ publishes weekly/fortnightly/monthly threshold amounts (periodised method, the pack default). Switch PAYE to CUMULATIVE only if your payroll specialist confirms it.',
  'NIS insurable wage ceiling (J$5,000,000 a year since 1 April 2022) and the age range for contributions (18 to 70).',
  'NHT and Education Tax stop at the retirement age of 65; confirm the employer share also stops for your employees.',
  'Education Tax base: gross emoluments less employee NIS and approved superannuation contributions (enter approved pension as a pre-tax deduction).',
  'HEART/NSTA: 3% employer levy on total gross emoluments; applies only when the employer’s total monthly gross emoluments exceed the HEART threshold (reported as J$14,444). Remove the component if your organisation is below it or exempt.',
  'Pension relief is limited by law (approved superannuation up to 20% of remuneration); the software does not cap it automatically.',
  'Pensioner / age-65+ additional exemptions apply to pension income and are not modelled for employment income.',
];

function pack(key: string, effectiveFrom: string, effectiveTo: string | null, threshold: string): ReferencePack {
  return {
    key,
    name: `Jamaica statutory reference pack from ${effectiveFrom} (threshold J$${Number(threshold).toLocaleString('en-US')}) — verify before approval`,
    effectiveFrom,
    effectiveTo,
    researchedOn: '2026-10-13',
    sources: SOURCES,
    verify: VERIFY,
    components: [
      {
        code: 'NIS',
        name: 'National Insurance Scheme',
        sortOrder: 10,
        base: 'GROSS',
        employeeRate: '0.03',
        employerRate: '0.03',
        annualCeiling: '5000000',
        annualThreshold: null,
        brackets: [],
        reducesStatutoryIncome: true,
        minAge: 18,
        maxAge: 69,
        calculationMethod: 'PERIOD',
        notes: '3% employee + 3% employer on insurable wages up to J$5,000,000 a year (since 1 Apr 2022). Contributions from 18 up to 70. Employee NIS reduces statutory income.',
      },
      {
        code: 'NHT',
        name: 'National Housing Trust',
        sortOrder: 20,
        base: 'GROSS',
        employeeRate: '0.02',
        employerRate: '0.03',
        annualCeiling: null,
        annualThreshold: null,
        brackets: [],
        reducesStatutoryIncome: false,
        minAge: 18,
        maxAge: 64,
        calculationMethod: 'PERIOD',
        notes: '2% employee + 3% employer on gross emoluments, no ceiling; employees 18 to under 65.',
      },
      {
        code: 'EDTAX',
        name: 'Education Tax',
        sortOrder: 30,
        base: 'STATUTORY_INCOME',
        employeeRate: '0.0225',
        employerRate: '0.035',
        annualCeiling: null,
        annualThreshold: null,
        brackets: [],
        reducesStatutoryIncome: false,
        minAge: 18,
        maxAge: 64,
        calculationMethod: 'PERIOD',
        notes: '2.25% employee + 3.5% employer on gross emoluments less employee NIS and approved superannuation; employees 18 to under 65.',
      },
      {
        code: 'PAYE',
        name: 'Income Tax (PAYE)',
        sortOrder: 40,
        base: 'STATUTORY_INCOME',
        employeeRate: '0',
        employerRate: '0',
        annualCeiling: null,
        annualThreshold: threshold,
        brackets: [
          { upToAnnual: '6000000', rate: '0.25' },
          { upToAnnual: null, rate: '0.30' },
        ],
        bracketBasis: 'BEFORE_THRESHOLD',
        reducesStatutoryIncome: false,
        minAge: null,
        maxAge: null,
        calculationMethod: 'PERIOD',
        notes: `Statutory income above the J$${threshold} threshold taxed at 25%; statutory income above J$6,000,000 a year at 30%.`,
      },
      {
        code: 'HEART',
        name: 'HEART/NSTA Trust (employer)',
        sortOrder: 50,
        base: 'GROSS',
        employeeRate: '0',
        employerRate: '0.03',
        annualCeiling: null,
        annualThreshold: null,
        brackets: [],
        reducesStatutoryIncome: false,
        minAge: null,
        maxAge: null,
        calculationMethod: 'PERIOD',
        notes: 'Employer-only 3% of gross emoluments, where the employer is above the HEART/NSTA payroll threshold.',
      },
    ],
  };
}

/** Thresholds take effect on 1 April each year (Jamaica's fiscal year). */
export const JAMAICA_REFERENCE_PACKS: ReferencePack[] = [
  pack('JM-2024-04', '2024-04-01', '2025-03-31', '1700088'),
  pack('JM-2025-04', '2025-04-01', '2026-03-31', '1799376'),
  pack('JM-2026-04', '2026-04-01', null, '1902360'),
];
