/** Client-side shapes of API responses (subset of fields used by the UI). */
export interface RefItem {
  id: string;
  code: string;
  name: string;
  active: boolean;
  description?: string | null;
}

export interface ReferenceData {
  departments: (RefItem & { costCenter?: string | null })[];
  branches: (RefItem & { parish?: string | null })[];
  positions: (RefItem & { departmentId?: string | null })[];
  employmentTypes: RefItem[];
  shiftTypes: (RefItem & { defaultStart?: string | null; defaultEnd?: string | null })[];
  leaveTypes: (RefItem & { category: string; payPercent: string; requiresDocument: boolean })[];
  overtimeRules: (RefItem & { multiplier: string })[];
  allowanceTypes: (RefItem & { taxable: boolean })[];
  deductionTypes: (RefItem & { category: string; preTax: boolean })[];
  payFrequencies: { frequency: string; standardHours: string; workingDays: string; periodsPerYear: number; active: boolean }[];
  publicHolidays: { id: string; date: string; name: string }[];
  parishes: string[];
}

export interface Employee {
  id: string;
  employeeNumber: string;
  firstName: string;
  middleName: string | null;
  lastName: string;
  preferredName: string | null;
  email: string | null;
  phone: string | null;
  mobile: string | null;
  dateOfBirth: string | null;
  gender: string | null;
  addressLine1: string | null;
  addressLine2: string | null;
  city: string | null;
  parish: string | null;
  trn: string | null;
  nisNumber: string | null;
  nhtNumber: string | null;
  identifiersRevealed: boolean;
  departmentId: string | null;
  branchId: string | null;
  positionId: string | null;
  employmentTypeId: string | null;
  supervisorId: string | null;
  department?: { id: string; name: string } | null;
  branch?: { id: string; name: string } | null;
  position?: { id: string; name: string } | null;
  employmentType?: { id: string; name: string } | null;
  supervisor?: { id: string; firstName: string; lastName: string; employeeNumber: string } | null;
  hireDate: string;
  probationEndDate: string | null;
  confirmationDate: string | null;
  terminationDate: string | null;
  terminationReason: string | null;
  payFrequency: 'WEEKLY' | 'FORTNIGHTLY' | 'MONTHLY';
  payType: 'SALARY' | 'HOURLY';
  salaryPerPeriod: string | null;
  hourlyRate: string | null;
  standardHoursOverride: string | null;
  compensationVisible: boolean;
  overtimeEligible: boolean;
  statutoryExemptions: string[];
  status: 'ACTIVE' | 'INACTIVE' | 'TERMINATED';
  version: number;
  source: string;
}

export interface EmployeeOption {
  id: string;
  employeeNumber: string;
  firstName: string;
  lastName: string;
  payFrequency: string;
  overtimeEligible: boolean;
  department?: { name: string } | null;
}

export type ApprovalStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED';

export interface PayrollRun {
  id: string;
  runNumber: string;
  frequency: string;
  runType: 'REGULAR' | 'SUPPLEMENTAL' | 'REVERSAL';
  revision: number;
  status: 'DRAFT' | 'PREPARED' | 'REVIEWED' | 'APPROVED' | 'LOCKED';
  periodStart: string;
  periodEnd: string;
  payDate: string;
  periodStatus: string;
  grossTotal: string;
  deductionTotal: string;
  employerTotal: string;
  netTotal: string;
  employeeCount: number;
  ruleVersionId: string | null;
  ruleVersionApproved: boolean;
  complianceCertified: boolean;
  exceptions: { employeeId: string; employeeNumber: string; name: string; message: string }[] | null;
  reversalOfRunId: string | null;
  notes: string | null;
  createdAt: string;
}
