import { z } from 'zod';

export const passwordSchema = z
  .string()
  .min(12, 'Use at least 12 characters')
  .max(128)
  .refine((v) => /[a-z]/.test(v) && /[A-Z]/.test(v) && /\d/.test(v), 'Include upper- and lower-case letters and a number');

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .pipe(z.email('Enter a valid email address').max(190));

export const registerSchema = z.object({
  companyLegalName: z.string().trim().min(2).max(190),
  companyDisplayName: z.string().trim().min(2).max(120),
  fullName: z.string().trim().min(2).max(120),
  email: emailSchema,
  password: passwordSchema,
  acceptTerms: z.literal(true, { message: 'You must accept the licence terms' }),
});
export type RegisterInput = z.infer<typeof registerSchema>;

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1).max(128),
});
export type LoginInput = z.infer<typeof loginSchema>;

export const mfaCodeSchema = z.object({ code: z.string().regex(/^\d{6}$/, 'Enter the 6-digit code') });
export const verifyEmailSchema = z.object({ token: z.string().min(20).max(200) });
export const forgotPasswordSchema = z.object({ email: emailSchema });
export const resetPasswordSchema = z.object({ token: z.string().min(20).max(200), password: passwordSchema });
export const changePasswordSchema = z.object({ currentPassword: z.string().min(1), newPassword: passwordSchema });
export const switchTenantSchema = z.object({ tenantId: z.string().min(1) });
export const acceptInviteSchema = z.object({
  token: z.string().min(20).max(200),
  fullName: z.string().trim().min(2).max(120).optional(),
  password: passwordSchema.optional(),
});

export interface MembershipSummary {
  tenantId: string;
  tenantName: string;
  tenantSlug: string;
  roles: string[];
  status: string;
}

export interface SessionUser {
  id: string;
  email: string;
  fullName: string;
  emailVerified: boolean;
  mfaEnabled: boolean;
}

export interface MeResponse {
  user: SessionUser;
  mfaVerified: boolean;
  mfaRequired: boolean;
  mfaSetupRequired: boolean;
  memberships: MembershipSummary[];
  activeTenant: null | {
    id: string;
    displayName: string;
    legalName: string;
    logoUrl: string | null;
    accentColor: string | null;
    roles: string[];
    permissions: string[];
    employeeId: string | null;
  };
  entitlements: null | EntitlementSummary;
  csrfToken: string;
}

export interface EntitlementSummary {
  planCode: string;
  planName: string;
  status: string;
  readOnly: boolean;
  periodEnd: string | null;
  graceEnd: string | null;
  employeeLimit: number;
  userLimit: number;
  activeEmployees: number;
  activeUsers: number;
  features: string[];
}

export interface PlatformMeResponse {
  user: SessionUser;
  platformRole: string;
  permissions: string[];
  mfaVerified: boolean;
  mfaSetupRequired: boolean;
  csrfToken: string;
}
