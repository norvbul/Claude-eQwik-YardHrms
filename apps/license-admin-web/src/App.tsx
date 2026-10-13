import { EmptyState } from '@yardhrms/ui';
import { Navigate, Route, Routes } from 'react-router-dom';
import { Layout, RequirePlatform } from './Layout';
import { Login, Mfa, ResetPassword } from './pages/Auth';
import { CustomerDetail, Customers, Dashboard, PaymentDetail, Payments, Plans, Products } from './pages/Commercial';
import { DataRequests } from './pages/DataRequests';
import { Invoices } from './pages/Invoices';
import { Codes, Licences, PlatformAudit, Renewals, Settings, SubscriptionDetail, Subscriptions, Usage } from './pages/Subscriptions';

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/mfa" element={<Mfa />} />
      <Route path="/reset-password" element={<ResetPassword />} />
      <Route element={<RequirePlatform />}>
        <Route element={<Layout />}>
          <Route index element={<Dashboard />} />
          <Route path="customers" element={<Customers />} />
          <Route path="customers/:id" element={<CustomerDetail />} />
          <Route path="products" element={<Products />} />
          <Route path="plans" element={<Plans />} />
          <Route path="payments" element={<Payments />} />
          <Route path="payments/:id" element={<PaymentDetail />} />
          <Route path="subscriptions" element={<Subscriptions />} />
          <Route path="subscriptions/:id" element={<SubscriptionDetail />} />
          <Route path="licences" element={<Licences />} />
          <Route path="codes" element={<Codes />} />
          <Route path="renewals" element={<Renewals />} />
          <Route path="usage" element={<Usage />} />
          <Route path="audit" element={<PlatformAudit />} />
          <Route path="settings" element={<Settings />} />
          <Route path="data-requests" element={<DataRequests />} />
          <Route path="invoices" element={<Invoices />} />
          <Route path="*" element={<EmptyState title="Page not found" />} />
        </Route>
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
