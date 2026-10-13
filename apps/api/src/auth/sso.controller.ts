import { Controller, Delete, Get, HttpCode, Param, Post, Query, Req, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import type { AuthContext } from './auth-context';
import { AllowNoTenant, AllowReadOnly, Auth, Public, RateLimit } from '../common/decorators';
import { SsoService } from './sso.service';

/** SEC-002: Google / Microsoft sign-in (OpenID Connect). */
@ApiTags('Authentication — single sign-on')
@Controller('auth/sso')
export class SsoController {
  constructor(private readonly sso: SsoService) {}

  @Get('providers')
  @Public()
  providers() {
    return this.sso.enabledProviders();
  }

  @Get(':provider/start')
  @Public()
  @RateLimit(30, 300)
  async start(@Param('provider') provider: string, @Query('next') next: string | undefined, @Res() res: Response) {
    res.redirect(302, await this.sso.start(res, provider, { next }));
  }

  @Get(':provider/callback')
  @Public()
  @RateLimit(30, 300)
  async callback(@Param('provider') provider: string, @Query() q: { code?: string; state?: string; error?: string }, @Req() req: Request, @Res() res: Response) {
    res.redirect(302, await this.sso.callback(req, res, provider, q));
  }

  /** Signed-in users link an external identity to their account (required for some Microsoft directories). */
  @Post(':provider/link')
  @AllowNoTenant()
  @AllowReadOnly()
  @HttpCode(200)
  async link(@Auth() a: AuthContext, @Param('provider') provider: string, @Res({ passthrough: true }) res: Response) {
    return { url: await this.sso.start(res, provider, { next: '/app/account', linkUserId: a.user.id }) };
  }

  @Get('identities')
  @AllowNoTenant()
  @AllowReadOnly()
  identities(@Auth() a: AuthContext) {
    return this.sso.identities(a.user.id);
  }

  @Delete('identities/:id')
  @AllowNoTenant()
  @AllowReadOnly()
  unlink(@Auth() a: AuthContext, @Param('id') id: string) {
    return this.sso.unlink(a.user.id, id);
  }
}
