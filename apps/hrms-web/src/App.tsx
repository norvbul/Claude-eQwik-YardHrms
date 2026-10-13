import { EmptyState, Spinner } from '@yardhrms/ui';
import { lazy, Suspense } from 'react';
import { Link, Navigate, Route, Routes } from 'react-router-dom';
import { AppLayout, RequireSession } from '@/layouts/AppLayout';
import { PublicLayout } from '@/layouts/PublicLayout';
import { AcceptInvite, ForgotPassword, Login, Register, ResetPassword, VerifyEmail } from '@/pages/public/Auth';
import { Landing } from '@/pages/public/Landing';
import { About, Copyright, Disclaimer, Licence, Privacy, Terms } from '@/pages/public/Legal';
import { SsoComplete } from '@/components/sso';
import { MfaChallenge, MfaSetup, SelectOrganization } from '@/pages/public/Mfa';
import { Dashboard } from '@/pages/app/Dashboard';

// Route-level code splitting for heavier screens
const Employees = lazy(() => import('@/pages/app/Employees').then((m) => ({ default: m.Employees })));
const EmployeeDetail = lazy(() => import('@/pages/app/EmployeeDetail').then((m) => ({ default: m.EmployeeDetail })));
const Leave = lazy(() => import('@/pages/app/Leave').then((m) => ({ default: m.Leave })));
const Timesheets = lazy(() => import('@/pages/app/Time').then((m) => ({ default: m.Timesheets })));
const Overtime = lazy(() => import('@/pages/app/Time').then((m) => ({ default: m.Overtime })));
const PayrollSetup = lazy(() => import('@/pages/app/PayrollSetup').then((m) => ({ default: m.PayrollSetup })));
const PayrollRuns = lazy(() => import('@/pages/app/Payroll').then((m) => ({ default: m.PayrollRuns })));
const PayrollRunDetail = lazy(() => import('@/pages/app/Payroll').then((m) => ({ default: m.PayrollRunDetail })));
const Payslips = lazy(() => import('@/pages/app/Payroll').then((m) => ({ default: m.Payslips })));
const Reports = lazy(() => import('@/pages/app/Reports').then((m) => ({ default: m.Reports })));
const Imports = lazy(() => import('@/pages/app/Imports').then((m) => ({ default: m.Imports })));
const ImportDetail = lazy(() => import('@/pages/app/Imports').then((m) => ({ default: m.ImportDetail })));
const UsersRoles = lazy(() => import('@/pages/app/Admin').then((m) => ({ default: m.UsersRoles })));
const CompanySettings = lazy(() => import('@/pages/app/Admin').then((m) => ({ default: m.CompanySettings })));
const Subscription = lazy(() => import('@/pages/app/Admin').then((m) => ({ default: m.Subscription })));
const AuditLog = lazy(() => import('@/pages/app/Admin').then((m) => ({ default: m.AuditLog })));
const Account = lazy(() => import('@/pages/app/Admin').then((m) => ({ default: m.Account })));

function NotFound() {
  return <EmptyState title="Page not found" description="The page you are looking for does not exist." action={<Link to="/app" className="text-brand underline">Go to dashboard</Link>} />;
}

export function App() {
  return (
    <Suspense fallback={<Spinner />}>
      <Routes>
        <Route element={<PublicLayout />}>
          <Route index element={<Landing />} />
          <Route path="about" element={<About />} />
          <Route path="licence" element={<Licence />} />
          <Route path="disclaimer" element={<Disclaimer />} />
          <Route path="copyright" element={<Copyright />} />
          <Route path="terms" element={<Terms />} />
          <Route path="privacy" element={<Privacy />} />
        </Route>
        <Route path="login" element={<Login />} />
        <Route path="sso/complete" element={<SsoComplete />} />
        <Route path="register" element={<Register />} />
        <Route path="verify-email" element={<VerifyEmail />} />
        <Route path="forgot-password" element={<ForgotPassword />} />
        <Route path="reset-password" element={<ResetPassword />} />
        <Route path="accept-invite" element={<AcceptInvite />} />
        <Route path="mfa" element={<MfaChallenge />} />
        <Route path="mfa/setup" element={<MfaSetup />} />
        <Route path="select-organization" element={<SelectOrganization />} />
        <Route path="app" element={<RequireSession />}>
          <Route element={<AppLayout />}>
            <Route index element={<Dashboard />} />
            <Route path="me" element={<EmployeeDetail selfService />} />
            <Route path="employees" element={<Employees />} />
            <Route path="employees/:id" element={<EmployeeDetail />} />
            <Route path="leave" element={<Leave />} />
            <Route path="timesheets" element={<Timesheets />} />
            <Route path="overtime" element={<Overtime />} />
            <Route path="payroll/setup" element={<PayrollSetup />} />
            <Route path="payroll/runs" element={<PayrollRuns />} />
            <Route path="payroll/runs/:id" element={<PayrollRunDetail />} />
            <Route path="payslips" element={<Payslips />} />
            <Route path="reports" element={<Reports />} />
            <Route path="imports" element={<Imports />} />
            <Route path="imports/:id" element={<ImportDetail />} />
            <Route path="users" element={<UsersRoles />} />
            <Route path="settings" element={<CompanySettings />} />
            <Route path="settings/data" element={<CompanySettings initialTab="data" />} />
            <Route path="subscription" element={<Subscription />} />
            <Route path="audit" element={<AuditLog />} />
            <Route path="account" element={<Account />} />
            <Route path="*" element={<NotFound />} />
          </Route>
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
  );
}
