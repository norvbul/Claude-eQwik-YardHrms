import { Controller, Get, HttpCode, Inject, Param, Patch, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { ALL_TENANT_PERMISSIONS, PERMISSION_DESCRIPTIONS, TenantPermissions as P } from '@yardhrms/authorization';
import { inviteUserSchema, roleSchema, updateMembershipSchema } from '@yardhrms/types';
import { z } from 'zod';
import { AuditService } from '../audit/audit.service';
import { requireTenant, type AuthContext } from '../auth/auth-context';
import { SessionService } from '../auth/session.service';
import { Auth, Permissions } from '../common/decorators';
import { CryptoService } from '../common/crypto.service';
import { badRequest, businessRule, conflict, notFound } from '../common/errors';
import { ZBody } from '../common/zod';
import { APP_CONFIG, type AppConfig } from '../config/config';
import { EntitlementsService } from '../entitlements/entitlements.service';
import { MailService } from '../mail/mail.service';
import { PrismaService, Tx } from '../prisma/prisma.service';

@ApiTags('Users & roles')
@Controller()
export class UsersController {
  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly entitlements: EntitlementsService,
    private readonly crypto: CryptoService,
    private readonly mail: MailService,
    private readonly sessions: SessionService,
  ) {}

  @Get('users')
  @Permissions(P.USERS_READ)
  async list(@Auth() a: AuthContext) {
    const auth = requireTenant(a);
    const rows = await this.prisma.tenantMembership.findMany({
      where: { tenantId: auth.tenantId },
      include: {
        user: { select: { id: true, email: true, fullName: true, lastLoginAt: true, mfaEnabledAt: true, emailVerifiedAt: true } },
        roles: { include: { role: { select: { id: true, code: true, name: true } } } },
        employee: { select: { id: true, employeeNumber: true, firstName: true, lastName: true } },
      },
      orderBy: { createdAt: 'asc' },
    });
    return rows.map((m) => ({
      id: m.id,
      status: m.status,
      user: { ...m.user, mfaEnabled: !!m.user.mfaEnabledAt, mfaEnabledAt: undefined },
      roles: m.roles.map((r) => r.role),
      employee: m.employee,
      createdAt: m.createdAt,
    }));
  }

  private async sendInvite(tx: Tx | PrismaService, userId: string, email: string, tenantId: string, tenantName: string) {
    const token = this.crypto.randomToken(32);
    await tx.emailToken.updateMany({ where: { userId, purpose: 'INVITE', tenantId, usedAt: null }, data: { usedAt: new Date() } });
    await tx.emailToken.create({ data: { userId, tenantId, purpose: 'INVITE', tokenHash: this.crypto.hmac(token), expiresAt: new Date(Date.now() + 7 * 86_400_000) } });
    const url = `${this.config.HRMS_WEB_URL}/accept-invite?token=${encodeURIComponent(token)}`;
    const { text, html } = this.mail.layout(`You're invited to ${tenantName}`, [`You have been invited to join ${tenantName} on eQwik YardHRMS™. The invitation expires in 7 days.`], {
      label: 'Accept invitation',
      url,
    });
    await this.mail.send({ to: email, subject: `Invitation to ${tenantName} on eQwik YardHRMS`, template: 'invite', text, html });
  }

  private async resolveRoles(tx: Tx | PrismaService, tenantId: string, codesOrIds: string[]) {
    const roles = await tx.role.findMany({ where: { tenantId, OR: [{ code: { in: codesOrIds } }, { id: { in: codesOrIds } }] } });
    if (roles.length !== new Set(codesOrIds).size) throw badRequest('One or more roles are invalid');
    return roles;
  }

  private async assertEmployeeLink(tx: Tx | PrismaService, tenantId: string, employeeId: string | null | undefined, membershipId?: string) {
    if (!employeeId) return;
    const e = await tx.employee.findFirst({ where: { id: employeeId, tenantId, deletedAt: null } });
    if (!e) throw badRequest('Employee not found');
    const linked = await tx.tenantMembership.findFirst({ where: { tenantId, employeeId, id: membershipId ? { not: membershipId } : undefined } });
    if (linked) throw conflict('That employee is already linked to another user');
  }

  /** SEC-005: invitations consume a licence seat (LIC-011 capacity enforced transactionally). */
  @Post('users/invite')
  @Permissions(P.USERS_MANAGE)
  async invite(@Auth() a: AuthContext, @ZBody(inviteUserSchema) body: z.infer<typeof inviteUserSchema>) {
    const auth = requireTenant(a);
    const tenant = await this.prisma.tenant.findUniqueOrThrow({ where: { id: auth.tenantId } });
    const result = await this.prisma.tx(async (tx) => {
      await this.entitlements.assertUserCapacity(tx, auth.tenantId, 1);
      const roles = await this.resolveRoles(tx, auth.tenantId, body.roleCodes);
      await this.assertEmployeeLink(tx, auth.tenantId, body.employeeId);
      let user = await tx.user.findUnique({ where: { email: body.email } });
      if (!user) user = await tx.user.create({ data: { email: body.email, fullName: body.fullName } });
      const existing = await tx.tenantMembership.findUnique({ where: { tenantId_userId: { tenantId: auth.tenantId, userId: user.id } } });
      if (existing) throw conflict('This person is already a user of your organization');
      const m = await tx.tenantMembership.create({
        data: { tenantId: auth.tenantId, userId: user.id, status: 'INVITED', employeeId: body.employeeId ?? null, invitedById: auth.user.id, roles: { create: roles.map((r) => ({ roleId: r.id })) } },
      });
      await this.audit.record({ tenantId: auth.tenantId, action: 'membership.invited', entityType: 'TenantMembership', entityId: m.id, after: { email: body.email, roles: roles.map((r) => r.code), employeeId: body.employeeId } }, tx);
      await this.sendInvite(tx, user.id, user.email, auth.tenantId, tenant.displayName);
      return m;
    });
    return { id: result.id, status: result.status };
  }

  @Post('users/:id/resend-invite')
  @Permissions(P.USERS_MANAGE)
  @HttpCode(200)
  async resend(@Auth() a: AuthContext, @Param('id') id: string) {
    const auth = requireTenant(a);
    const m = await this.prisma.tenantMembership.findFirst({ where: { id, tenantId: auth.tenantId }, include: { user: true, tenant: true } });
    if (!m) throw notFound('User');
    if (m.status !== 'INVITED') throw businessRule('Only pending invitations can be resent');
    await this.sendInvite(this.prisma, m.userId, m.user.email, auth.tenantId, m.tenant.displayName);
    return { sent: true };
  }

  @Patch('users/:id')
  @Permissions(P.USERS_MANAGE)
  async update(@Auth() a: AuthContext, @Param('id') id: string, @ZBody(updateMembershipSchema) body: z.infer<typeof updateMembershipSchema>) {
    const auth = requireTenant(a);
    return this.prisma.tx(async (tx) => {
      const m = await tx.tenantMembership.findFirst({ where: { id, tenantId: auth.tenantId }, include: { roles: { include: { role: true } } } });
      if (!m) throw notFound('User');
      if (body.employeeId !== undefined) {
        await this.assertEmployeeLink(tx, auth.tenantId, body.employeeId, m.id);
        await tx.tenantMembership.update({ where: { id: m.id }, data: { employeeId: body.employeeId } });
      }
      if (body.roleIds) {
        const roles = await this.resolveRoles(tx, auth.tenantId, body.roleIds);
        const removingAdmin = m.roles.some((r) => r.role.code === 'COMPANY_ADMIN') && !roles.some((r) => r.code === 'COMPANY_ADMIN');
        if (removingAdmin) await this.assertAnotherAdmin(tx, auth.tenantId, m.id);
        await tx.membershipRole.deleteMany({ where: { membershipId: m.id } });
        await tx.membershipRole.createMany({ data: roles.map((r) => ({ membershipId: m.id, roleId: r.id })) });
        // Privilege change: force re-authentication of the affected user's sessions for this tenant.
        await tx.session.updateMany({ where: { userId: m.userId, tenantId: auth.tenantId, revokedAt: null, id: { not: auth.session.id } }, data: { revokedAt: new Date() } });
        await this.audit.record(
          { tenantId: auth.tenantId, action: 'membership.roles_changed', entityType: 'TenantMembership', entityId: m.id, before: { roles: m.roles.map((r) => r.role.code) }, after: { roles: roles.map((r) => r.code) } },
          tx,
        );
      }
      return { updated: true };
    });
  }

  private async assertAnotherAdmin(tx: Tx, tenantId: string, excludingMembershipId: string) {
    const admins = await tx.tenantMembership.count({
      where: { tenantId, status: 'ACTIVE', id: { not: excludingMembershipId }, roles: { some: { role: { code: 'COMPANY_ADMIN' } } } },
    });
    if (admins === 0) throw businessRule('Your organization must keep at least one active Company Administrator');
  }

  @Post('users/:id/deactivate')
  @Permissions(P.USERS_MANAGE)
  @HttpCode(200)
  async deactivate(@Auth() a: AuthContext, @Param('id') id: string) {
    const auth = requireTenant(a);
    if (id === auth.membershipId) throw businessRule('You cannot deactivate your own access');
    await this.prisma.tx(async (tx) => {
      const m = await tx.tenantMembership.findFirst({ where: { id, tenantId: auth.tenantId } });
      if (!m) throw notFound('User');
      if (m.status === 'DEACTIVATED') throw businessRule('User is already deactivated');
      await this.assertAnotherAdmin(tx, auth.tenantId, m.id);
      await tx.tenantMembership.update({ where: { id: m.id }, data: { status: 'DEACTIVATED' } });
      await tx.session.updateMany({ where: { userId: m.userId, tenantId: auth.tenantId, revokedAt: null }, data: { revokedAt: new Date() } });
      await this.audit.record({ tenantId: auth.tenantId, action: 'membership.deactivated', entityType: 'TenantMembership', entityId: m.id, before: { status: m.status }, after: { status: 'DEACTIVATED' } }, tx);
    });
    return { deactivated: true };
  }

  @Post('users/:id/reactivate')
  @Permissions(P.USERS_MANAGE)
  @HttpCode(200)
  async reactivate(@Auth() a: AuthContext, @Param('id') id: string) {
    const auth = requireTenant(a);
    await this.prisma.tx(async (tx) => {
      const m = await tx.tenantMembership.findFirst({ where: { id, tenantId: auth.tenantId }, include: { user: true } });
      if (!m) throw notFound('User');
      if (m.status !== 'DEACTIVATED') throw businessRule('User is not deactivated');
      await this.entitlements.assertUserCapacity(tx, auth.tenantId, 1);
      await tx.tenantMembership.update({ where: { id: m.id }, data: { status: m.user.passwordHash ? 'ACTIVE' : 'INVITED' } });
      await this.audit.record({ tenantId: auth.tenantId, action: 'membership.reactivated', entityType: 'TenantMembership', entityId: m.id }, tx);
    });
    return { reactivated: true };
  }

  // ── Roles ───────────────────────────────────────────────────────────────
  @Get('roles')
  @Permissions(P.USERS_READ)
  async roles(@Auth() a: AuthContext) {
    const auth = requireTenant(a);
    const roles = await this.prisma.role.findMany({ where: { tenantId: auth.tenantId }, include: { permissions: true, _count: { select: { members: true } } }, orderBy: { name: 'asc' } });
    return roles.map((r) => ({ ...r, permissions: r.permissions.map((p) => p.permissionCode), memberCount: r._count.members }));
  }

  @Get('permissions')
  @Permissions(P.USERS_READ)
  permissions() {
    return ALL_TENANT_PERMISSIONS.map((code) => ({ code, description: PERMISSION_DESCRIPTIONS[code] }));
  }

  @Post('roles')
  @Permissions(P.ROLES_MANAGE)
  async createRole(@Auth() a: AuthContext, @ZBody(roleSchema) body: z.infer<typeof roleSchema>) {
    const auth = requireTenant(a);
    this.assertPermissionCodes(body.permissions);
    const code = `CUSTOM_${this.crypto.randomHex(4).toUpperCase()}`;
    const role = await this.prisma.role.create({
      data: { tenantId: auth.tenantId, code, name: body.name, description: body.description ?? null, permissions: { create: body.permissions.map((p) => ({ permissionCode: p })) } },
    });
    await this.audit.record({ tenantId: auth.tenantId, action: 'role.created', entityType: 'Role', entityId: role.id, after: body });
    return role;
  }

  @Patch('roles/:id')
  @Permissions(P.ROLES_MANAGE)
  async updateRole(@Auth() a: AuthContext, @Param('id') id: string, @ZBody(roleSchema) body: z.infer<typeof roleSchema>) {
    const auth = requireTenant(a);
    this.assertPermissionCodes(body.permissions);
    return this.prisma.tx(async (tx) => {
      const role = await tx.role.findFirst({ where: { id, tenantId: auth.tenantId }, include: { permissions: true } });
      if (!role) throw notFound('Role');
      if (role.code === 'COMPANY_ADMIN') throw businessRule('The Company Administrator role always has every permission and cannot be edited');
      await tx.role.update({ where: { id }, data: { name: body.name, description: body.description ?? null } });
      await tx.rolePermission.deleteMany({ where: { roleId: id } });
      await tx.rolePermission.createMany({ data: body.permissions.map((p) => ({ roleId: id, permissionCode: p })) });
      await this.audit.record({ tenantId: auth.tenantId, action: 'role.updated', entityType: 'Role', entityId: id, before: { permissions: role.permissions.map((p) => p.permissionCode) }, after: body }, tx);
      return { updated: true };
    });
  }

  private assertPermissionCodes(codes: string[]) {
    const valid = new Set<string>(ALL_TENANT_PERMISSIONS);
    const bad = codes.filter((c) => !valid.has(c));
    if (bad.length) throw badRequest(`Unknown permissions: ${bad.join(', ')}`);
  }
}
