import { Controller, Get, HttpCode, Post, Query, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import {
  acceptInviteSchema,
  changePasswordSchema,
  forgotPasswordSchema,
  loginSchema,
  mfaCodeSchema,
  registerSchema,
  resetPasswordSchema,
  switchTenantSchema,
  verifyEmailSchema,
} from '@yardhrms/types';
import { z } from 'zod';
import { AllowMfaPending, AllowNoTenant, AllowReadOnly, Auth, PlatformRoute, Public, RateLimit } from '../common/decorators';
import { ZBody } from '../common/zod';
import type { AuthContext } from './auth-context';
import { AuthService } from './auth.service';

@ApiTags('Identity')
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @RateLimit(5, 3600)
  @Post('register')
  register(@ZBody(registerSchema) body: z.infer<typeof registerSchema>) {
    return this.auth.register(body);
  }

  @Public()
  @RateLimit(20, 3600)
  @Post('verify-email')
  @HttpCode(200)
  verifyEmail(@ZBody(verifyEmailSchema) body: z.infer<typeof verifyEmailSchema>) {
    return this.auth.verifyEmail(body.token);
  }

  @Public()
  @RateLimit(5, 3600)
  @Post('resend-verification')
  @HttpCode(200)
  resend(@ZBody(forgotPasswordSchema) body: z.infer<typeof forgotPasswordSchema>) {
    return this.auth.resendVerification(body.email);
  }

  @Public()
  @RateLimit(10, 300)
  @Post('login')
  @HttpCode(200)
  login(@ZBody(loginSchema) body: z.infer<typeof loginSchema>, @Res({ passthrough: true }) res: Response) {
    return this.auth.login(res, body.email, body.password, 'TENANT');
  }

  @AllowNoTenant()
  @AllowMfaPending()
  @AllowReadOnly()
  @Post('logout')
  @HttpCode(200)
  logout(@Auth() auth: AuthContext, @Res({ passthrough: true }) res: Response) {
    return this.auth.logout(res, auth);
  }

  @AllowNoTenant()
  @AllowMfaPending()
  @Get('me')
  me(@Auth() auth: AuthContext) {
    return this.auth.me(auth);
  }

  @AllowNoTenant()
  @AllowMfaPending()
  @AllowReadOnly()
  @RateLimit(10, 300)
  @Post('mfa/challenge')
  @HttpCode(200)
  mfaChallenge(@Auth() auth: AuthContext, @ZBody(mfaCodeSchema) body: z.infer<typeof mfaCodeSchema>, @Res({ passthrough: true }) res: Response) {
    return this.auth.mfaChallenge(res, auth, body.code);
  }

  @AllowNoTenant()
  @AllowMfaPending()
  @AllowReadOnly()
  @Post('mfa/setup')
  @HttpCode(200)
  mfaSetup(@Auth() auth: AuthContext) {
    return this.auth.mfaSetupStart(auth);
  }

  @AllowNoTenant()
  @AllowMfaPending()
  @AllowReadOnly()
  @RateLimit(10, 300)
  @Post('mfa/confirm')
  @HttpCode(200)
  mfaConfirm(@Auth() auth: AuthContext, @ZBody(mfaCodeSchema) body: z.infer<typeof mfaCodeSchema>, @Res({ passthrough: true }) res: Response) {
    return this.auth.mfaSetupConfirm(res, auth, body.code);
  }

  @Public()
  @RateLimit(5, 900)
  @Post('forgot-password')
  @HttpCode(200)
  forgot(@ZBody(forgotPasswordSchema) body: z.infer<typeof forgotPasswordSchema>) {
    return this.auth.forgotPassword(body.email, 'TENANT');
  }

  @Public()
  @RateLimit(10, 900)
  @Post('reset-password')
  @HttpCode(200)
  reset(@ZBody(resetPasswordSchema) body: z.infer<typeof resetPasswordSchema>) {
    return this.auth.resetPassword(body.token, body.password);
  }

  @AllowNoTenant()
  @AllowReadOnly()
  @Post('change-password')
  @HttpCode(200)
  change(@Auth() auth: AuthContext, @ZBody(changePasswordSchema) body: z.infer<typeof changePasswordSchema>) {
    return this.auth.changePassword(auth, body.currentPassword, body.newPassword);
  }

  @AllowNoTenant()
  @AllowReadOnly()
  @Post('switch-tenant')
  @HttpCode(200)
  switchTenant(@Auth() auth: AuthContext, @ZBody(switchTenantSchema) body: z.infer<typeof switchTenantSchema>, @Res({ passthrough: true }) res: Response) {
    return this.auth.switchTenant(res, auth, body.tenantId);
  }

  @Public()
  @RateLimit(30, 3600)
  @Get('invitations/preview')
  invitePreview(@Query('token') token: string) {
    return this.auth.invitePreview(String(token ?? ''));
  }

  @Public()
  @RateLimit(10, 3600)
  @Post('invitations/accept')
  @HttpCode(200)
  acceptInvite(@ZBody(acceptInviteSchema) body: z.infer<typeof acceptInviteSchema>) {
    return this.auth.acceptInvite(body.token, body.fullName, body.password);
  }
}

@ApiTags('Qwik Platform — Identity')
@PlatformRoute()
@Controller('platform/auth')
export class PlatformAuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @RateLimit(10, 300)
  @Post('login')
  @HttpCode(200)
  login(@ZBody(loginSchema) body: z.infer<typeof loginSchema>, @Res({ passthrough: true }) res: Response) {
    return this.auth.login(res, body.email, body.password, 'PLATFORM');
  }

  @AllowMfaPending()
  @Post('logout')
  @HttpCode(200)
  logout(@Auth() auth: AuthContext, @Res({ passthrough: true }) res: Response) {
    return this.auth.logout(res, auth);
  }

  @AllowMfaPending()
  @Get('me')
  me(@Auth() auth: AuthContext) {
    return this.auth.platformMe(auth);
  }

  @AllowMfaPending()
  @RateLimit(10, 300)
  @Post('mfa/challenge')
  @HttpCode(200)
  mfaChallenge(@Auth() auth: AuthContext, @ZBody(mfaCodeSchema) body: z.infer<typeof mfaCodeSchema>, @Res({ passthrough: true }) res: Response) {
    return this.auth.mfaChallenge(res, auth, body.code);
  }

  @AllowMfaPending()
  @Post('mfa/setup')
  @HttpCode(200)
  mfaSetup(@Auth() auth: AuthContext) {
    return this.auth.mfaSetupStart(auth);
  }

  @AllowMfaPending()
  @RateLimit(10, 300)
  @Post('mfa/confirm')
  @HttpCode(200)
  mfaConfirm(@Auth() auth: AuthContext, @ZBody(mfaCodeSchema) body: z.infer<typeof mfaCodeSchema>, @Res({ passthrough: true }) res: Response) {
    return this.auth.mfaSetupConfirm(res, auth, body.code);
  }

  @Public()
  @RateLimit(5, 900)
  @Post('forgot-password')
  @HttpCode(200)
  forgot(@ZBody(forgotPasswordSchema) body: z.infer<typeof forgotPasswordSchema>) {
    return this.auth.forgotPassword(body.email, 'PLATFORM');
  }

  @Public()
  @RateLimit(10, 900)
  @Post('reset-password')
  @HttpCode(200)
  reset(@ZBody(resetPasswordSchema) body: z.infer<typeof resetPasswordSchema>) {
    return this.auth.resetPassword(body.token, body.password);
  }

  @Post('change-password')
  @HttpCode(200)
  change(@Auth() auth: AuthContext, @ZBody(changePasswordSchema) body: z.infer<typeof changePasswordSchema>) {
    return this.auth.changePassword(auth, body.currentPassword, body.newPassword);
  }
}
