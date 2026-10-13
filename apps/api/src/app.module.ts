import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { CoreModule } from './core/core.module';
import { AuthGuard } from './auth/auth.guard';
import { AuthController, PlatformAuthController } from './auth/auth.controller';
import { AuthService } from './auth/auth.service';
import { CompanyController } from './tenancy/company.controller';
import { MasterDataController } from './masterdata/masterdata.controller';
import { UsersController } from './users/users.controller';
import { EmployeesController } from './employees/employees.controller';
import { EmployeesService } from './employees/employees.service';
import { LeaveController } from './leave/leave.controller';
import { LeaveService } from './leave/leave.service';
import { OvertimeController, TimesheetsController } from './time/time.controller';
import { TimeService } from './time/time.service';
import { PayrollRunsController, PayrollSetupController, PayslipsController } from './payroll/payroll.controller';
import { PayrollService } from './payroll/payroll.service';
import { PayslipService } from './payroll/payslip.service';
import { StatutoryService } from './payroll/statutory.service';
import { ImportsController } from './imports/imports.controller';
import { ImportsService } from './imports/imports.service';
import { ReportsController } from './reports/reports.controller';
import { ReportsService } from './reports/reports.service';
import { SubscriptionController } from './subscription/subscription.controller';
import { PlatformController } from './platform/platform.controller';
import { PlatformService } from './platform/platform.service';
import { HealthController } from './health.controller';
import { NotificationsController } from './notifications/notifications.controller';
import { DataLifecycleController, PlatformDataLifecycleController } from './retention/data-lifecycle.controller';
import { DataExportService } from './retention/data-export.service';
import { RetentionService } from './retention/retention.service';
import { PlatformBillingController, TenantBillingController } from './billing/billing.controller';
import { BillingService } from './billing/billing.service';

export const DOMAIN_PROVIDERS = [AuthService, EmployeesService, LeaveService, TimeService, StatutoryService, PayrollService, PayslipService, ImportsService, ReportsService, PlatformService, RetentionService, DataExportService, BillingService];

@Module({
  imports: [CoreModule],
  controllers: [
    HealthController,
    AuthController,
    PlatformAuthController,
    CompanyController,
    MasterDataController,
    UsersController,
    EmployeesController,
    LeaveController,
    TimesheetsController,
    OvertimeController,
    PayrollSetupController,
    PayrollRunsController,
    PayslipsController,
    ImportsController,
    ReportsController,
    SubscriptionController,
    PlatformController,
    NotificationsController,
    DataLifecycleController,
    PlatformDataLifecycleController,
    PlatformBillingController,
    TenantBillingController,
  ],
  providers: [{ provide: APP_GUARD, useClass: AuthGuard }, ...DOMAIN_PROVIDERS],
})
export class AppModule {}
