import { Body, Controller, Get, HttpCode, Post, Req } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { AuthService } from './auth.service';
import {
  ChangePasswordDto,
  LoginDto,
  RefreshDto,
  SessionResponse,
} from './auth.dto';
import { CurrentUser, Public } from '../decorators';
import { AllowPendingPassword } from '../guards/must-change-password.guard';
import { AgentsService } from '../agents/agents.service';
import type { AuthenticatedActor } from '../../../shared/request-context/request-context';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly agents: AgentsService,
  ) {}

  @Public()
  @Post('login')
  @HttpCode(200)
  // Login sin proteccion es la puerta de entrada a la fuerza bruta: 5 intentos/min.
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @ApiOperation({ summary: 'Inicia sesion y devuelve el par de tokens' })
  login(@Body() dto: LoginDto, @Req() req: Request): Promise<SessionResponse> {
    return this.auth.login(dto.email, dto.password, meta(req));
  }

  @Public()
  @Post('refresh')
  @HttpCode(200)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @ApiOperation({
    summary: 'Rota el refresh token y emite un access token nuevo',
  })
  refresh(
    @Body() dto: RefreshDto,
    @Req() req: Request,
  ): Promise<SessionResponse> {
    return this.auth.refresh(dto.refreshToken, meta(req));
  }

  @Post('logout')
  @AllowPendingPassword()
  @HttpCode(204)
  @ApiOperation({ summary: 'Revoca el refresh token de la sesion actual' })
  async logout(@Body() dto: RefreshDto): Promise<void> {
    await this.auth.logout(dto.refreshToken);
  }

  @Get('me')
  @AllowPendingPassword()
  @ApiOperation({ summary: 'Perfil del asesor autenticado' })
  async me(@CurrentUser() actor: AuthenticatedActor) {
    const agent = await this.agents.findById(actor.id);
    return {
      id: agent.id,
      email: agent.email,
      firstName: agent.firstName,
      lastName: agent.lastName,
      fullName: agent.fullName,
      role: agent.role,
      status: agent.status,
      photoUrl: agent.photoUrl,
      cellPhone: agent.cellPhone,
      hasWhatsapp: agent.hasWhatsapp,
      mustSetPassword: agent.mustSetPassword,
      lastLoginAt: agent.lastLoginAt,
    };
  }

  @Post('change-password')
  @AllowPendingPassword()
  @HttpCode(204)
  @ApiOperation({
    summary: 'Cambia la contrasena y cierra el resto de sesiones',
    description:
      'Unica ruta operativa mientras el asesor conserve la clave generica inicial.',
  })
  async changePassword(
    @CurrentUser() actor: AuthenticatedActor,
    @Body() dto: ChangePasswordDto,
  ): Promise<void> {
    await this.auth.changePassword(
      actor.id,
      dto.currentPassword,
      dto.newPassword,
    );
  }
}

function meta(req: Request) {
  return {
    userAgent: req.headers['user-agent'],
    ipAddress: req.ip ?? req.socket.remoteAddress ?? undefined,
  };
}
