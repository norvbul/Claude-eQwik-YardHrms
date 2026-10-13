import { Global, Module } from '@nestjs/common';
import { APP_CONFIG, loadConfig } from '../config/config';
import { PrismaService } from '../prisma/prisma.service';
import { CryptoService } from '../common/crypto.service';
import { AuditService } from '../audit/audit.service';
import { MailService } from '../mail/mail.service';
import { StorageService } from '../storage/storage.service';
import { RateLimitService } from '../common/rate-limit.service';
import { EntitlementsService } from '../entitlements/entitlements.service';
import { SessionService } from '../auth/session.service';
import { PasswordService } from '../auth/password.service';
import { MfaService } from '../auth/mfa.service';
import { LicensingCore } from '../licensing/licensing-core.service';
import { ProvisioningService } from '../tenancy/provisioning.service';
import { JobsService } from '../jobs/jobs.service';
import { NotificationService } from '../notifications/notification.service';

const providers = [
  { provide: APP_CONFIG, useFactory: () => loadConfig() },
  PrismaService,
  CryptoService,
  AuditService,
  MailService,
  StorageService,
  RateLimitService,
  EntitlementsService,
  SessionService,
  PasswordService,
  MfaService,
  LicensingCore,
  ProvisioningService,
  JobsService,
  NotificationService,
];

@Global()
@Module({ providers, exports: providers })
export class CoreModule {}
