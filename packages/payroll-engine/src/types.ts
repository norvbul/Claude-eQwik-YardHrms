export type PayFrequency = 'WEEKLY' | 'FORTNIGHTLY' | 'MONTHLY';
export type PayType = 'SALARY' | 'HOURLY';

/** Which earnings amount a statutory component is applied to. */
export type StatutoryBase =
  /** All earnings, taxable and non-taxable. */
  | 'GROSS'
  /** Taxable earnings only. */
  | 'TAXABLE_GROSS'
  /**
   * Taxable earnings less pre-tax voluntary deductions (e.g. approved pension) and less the
   * employee amount of any previously computed component flagged `reducesStatutoryIncome`.
   */
  | 'STATUTORY_INCOME';

export interface TaxBracketDef {
  /** Upper bound of the bracket in annual taxable amount after threshold; null = unbounded. */
  upToAnnual: string | null;
  /** Rate as a decimal fraction, e.g. "0.25". */
  rate: string;
}

export interface StatutoryComponentDef {
  code: string;
  name: string;
  /** Lower numbers are calculated first. Components that reduce statutory income must precede those using it. */
  sortOrder: number;
  base: StatutoryBase;
  /** Employee rate as fraction. Ignored when `brackets` is non-empty. */
  employeeRate: string;
  /** Employer contribution rate as fraction (may be 0). */
  employerRate: string;
  /** Annual earnings ceiling applied to the base (periodized). null = no ceiling. */
  annualCeiling?: string | null;
  /** Annual exempt threshold deducted from the base before rates/brackets (periodized). null = none. */
  annualThreshold?: string | null;
  /** Progressive brackets applied to (base - threshold). */
  brackets?: TaxBracketDef[];
  /** Whether the employee amount reduces STATUTORY_INCOME for later components. */
  reducesStatutoryIncome?: boolean;
  /** Optional eligibility by age at period end (inclusive bounds). */
  minAge?: number | null;
  maxAge?: number | null;
}

export interface StatutoryRuleSet {
  versionId: string;
  versionName: string;
  /** true only when the version has been approved by an authorized reviewer. */
  approved: boolean;
  components: StatutoryComponentDef[];
}

export type EarningCategory =
  | 'BASIC'
  | 'OVERTIME'
  | 'ALLOWANCE'
  | 'BONUS'
  | 'COMMISSION'
  | 'RETRO'
  | 'LEAVE_PAID'
  | 'LEAVE_UNPAID'
  | 'OTHER';

export interface OvertimeInput {
  hours: string;
  multiplier: string;
  description: string;
}

export interface AmountLineInput {
  code: string;
  description: string;
  amount: string;
  taxable: boolean;
  category?: Exclude<EarningCategory, 'BASIC' | 'OVERTIME' | 'LEAVE_PAID' | 'LEAVE_UNPAID'>;
}

export interface LeaveImpactInput {
  description: string;
  days: string;
  /** Percent of pay retained during leave: 100 = fully paid, 0 = unpaid. */
  payPercent: string;
}

export interface VoluntaryDeductionInput {
  code: string;
  description: string;
  amount: string;
  category: string;
  /** Pre-tax deductions (e.g. approved pension) reduce STATUTORY_INCOME. */
  preTax: boolean;
}

export interface EmployeePayInput {
  employeeId: string;
  payFrequency: PayFrequency;
  payType: PayType;
  /** Contractual salary per pay period (SALARY). For monthly employees: the monthly amount. */
  salaryPerPeriod?: string | null;
  /** Hourly rate (HOURLY). */
  hourlyRate?: string | null;
  /** Standard hours per period, e.g. 173.33 for monthly by default (configurable). */
  standardHoursPerPeriod: string;
  /** Standard working days per period used for leave and proration (e.g. 5 / 10 / 21.67). */
  workingDaysPerPeriod: string;
  /** Approved regular timesheet hours (HOURLY employees). */
  approvedRegularHours?: string | null;
  /** Fraction of the period employed (new hire / termination proration). Default 1. */
  prorationFactor?: string | null;
  overtime: OvertimeInput[];
  allowances: AmountLineInput[];
  oneOffEarnings: AmountLineInput[];
  leave: LeaveImpactInput[];
  voluntaryDeductions: VoluntaryDeductionInput[];
  ageAtPeriodEnd?: number | null;
  /** Statutory component codes from which this employee is exempt (documented exemption). */
  statutoryExemptions?: string[];
}

export interface EarningLine {
  code: string;
  category: EarningCategory;
  description: string;
  quantity: string | null;
  rate: string | null;
  amount: string;
  taxable: boolean;
}

export interface StatutoryLine {
  code: string;
  name: string;
  base: string;
  cappedBase: string;
  taxableAfterThreshold: string;
  employeeAmount: string;
  employerAmount: string;
  exempt: boolean;
  note?: string;
}

export interface DeductionLine {
  code: string;
  description: string;
  category: string;
  amount: string;
  preTax: boolean;
}

export interface PayResult {
  employeeId: string;
  periodsPerYear: number;
  hourlyEquivalent: string;
  earnings: EarningLine[];
  grossPay: string;
  taxableGross: string;
  nonTaxableGross: string;
  statutoryIncome: string;
  statutory: StatutoryLine[];
  voluntary: DeductionLine[];
  totalStatutoryEmployee: string;
  totalVoluntary: string;
  totalEmployeeDeductions: string;
  totalEmployerContributions: string;
  netPay: string;
  ruleVersionId: string;
  ruleVersionName: string;
  ruleVersionApproved: boolean;
  warnings: string[];
}
