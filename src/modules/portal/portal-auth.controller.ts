import {
  Body,
  Controller,
  ForbiddenException,
  HttpCode,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { AppConfigService } from '../../shared/config/app-config.service';
import { Public } from '../iam/decorators';
import { CaptchaService } from '../public/captcha.service';
import {
  AllowPendingClientPassword,
  ClientAuthGuard,
  CurrentClient,
} from './client-auth.guard';
import type { AuthenticatedClient } from './client-jwt.strategy';
import { PortalAuthService, type PortalSession } from './portal-auth.service';
import {
  ChangePortalPasswordDto,
  LoginPortalDto,
  RegisterPortalDto,
} from './dto/portal.dto';

/**
 * El refresh token no viaja en el cuerpo como el de los asesores: va en una
 * cookie `httpOnly`, que ningun script de la pagina puede leer. Un XSS en la
 * web publica podria robar el access token que vive en memoria —quince
 * minutos— pero no la credencial de larga duracion con la que se renuevan
 * sesiones durante una semana.
 *
 * `SameSite=Strict` la deja fuera de cualquier peticion originada en otro
 * sitio, que es lo que cierra el CSRF; y `path` la limita a las rutas de sesion
 * del portal, asi que ni siquiera se envia al resto de la API.
 */
const COOKIE = 'serrano_portal_rt';

@ApiTags('portal')
@Public()
@Controller('portal/auth')
export class PortalAuthController {
  constructor(
    private readonly auth: PortalAuthService,
    private readonly captcha: CaptchaService,
    private readonly config: AppConfigService,
  ) {}

  @Post('register')
  @HttpCode(202)
  // Un alta es cara (argon2) y crea filas en la cartera: se limita fuerte.
  @Throttle({ default: { limit: 3, ttl: 600_000 } })
  @ApiOperation({
    summary: 'Crea una cuenta de propietario',
    description:
      'Responde siempre igual, exista o no el correo: contestar distinto ' +
      'convertiria el formulario en una forma de averiguar quien es cliente.',
  })
  async register(@Body() dto: RegisterPortalDto, @Req() req: Request) {
    await this.captcha.verify(dto.captchaToken, ip(req));
    await this.auth.register(dto, meta(req));
    return {
      message:
        'Recibimos tus datos. Si el correo no estaba registrado ya puedes ' +
        'iniciar sesión; si lo estaba, un asesor te contactará para darte acceso.',
    };
  }

  @Post('login')
  @HttpCode(200)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @ApiOperation({ summary: 'Inicia sesión en el portal' })
  async login(
    @Body() dto: LoginPortalDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    assertSameOrigin(req, this.config);
    const session = await this.auth.login(dto, meta(req));
    return this.respond(res, session);
  }

  @Post('refresh')
  @HttpCode(200)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @ApiOperation({ summary: 'Renueva la sesión con la cookie' })
  async refresh(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    assertSameOrigin(req, this.config);
    const session = await this.auth.refresh(
      readCookie(req, COOKIE) ?? '',
      meta(req),
    );
    return this.respond(res, session);
  }

  @Post('logout')
  @HttpCode(204)
  @ApiOperation({ summary: 'Cierra la sesión y borra la cookie' })
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    await this.auth.logout(readCookie(req, COOKIE));
    res.clearCookie(COOKIE, this.cookieOptions());
  }

  @Post('change-password')
  @UseGuards(ClientAuthGuard)
  @AllowPendingClientPassword()
  @HttpCode(204)
  @ApiOperation({
    summary: 'Cambia la contraseña y cierra el resto de sesiones',
    description:
      'Única ruta operativa mientras el cliente conserve la clave que le dio ' +
      'un asesor.',
  })
  async changePassword(
    @CurrentClient() client: AuthenticatedClient,
    @Body() dto: ChangePortalPasswordDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    await this.auth.changePassword(
      client.id,
      dto.currentPassword,
      dto.password,
    );
    // Se revocaron todas las sesiones, incluida esta: la cookie ya no sirve.
    res.clearCookie(COOKIE, this.cookieOptions());
  }

  /** Deja el refresh en la cookie y devuelve el resto. */
  private respond(res: Response, session: PortalSession) {
    res.cookie(COOKIE, session.refreshToken, {
      ...this.cookieOptions(),
      maxAge: 7 * 24 * 3600 * 1000,
    });
    return {
      accessToken: session.accessToken,
      expiresIn: session.expiresIn,
      client: session.client,
    };
  }

  private cookieOptions() {
    return {
      httpOnly: true,
      // En desarrollo la web va por http: con `secure` el navegador la
      // descartaria y no habria forma de probar el flujo.
      secure: this.config.isProduction,
      sameSite: 'strict' as const,
      path: `/${this.config.apiPrefix}/portal/auth`,
    };
  }
}

function meta(req: Request) {
  return {
    userAgent: req.headers['user-agent'],
    ipAddress: ip(req),
  };
}

function ip(req: Request): string | undefined {
  return req.ip ?? req.socket.remoteAddress ?? undefined;
}

/** Sin `cookie-parser`: leer una cabecera no justifica una dependencia mas. */
function readCookie(req: Request, name: string): string | undefined {
  const header = req.headers.cookie;
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index === -1) continue;
    if (part.slice(0, index).trim() === name) {
      return decodeURIComponent(part.slice(index + 1).trim());
    }
  }
  return undefined;
}

/**
 * `SameSite=Strict` ya impide que la cookie viaje en una peticion nacida en
 * otro sitio. Esto es el segundo cerrojo: si un dia alguien relaja la cookie o
 * un navegador viejo la ignora, el `Origin` sigue delatando la peticion ajena.
 */
function assertSameOrigin(req: Request, config: AppConfigService): void {
  const origin = req.headers.origin;
  // Las peticiones del mismo origen pueden no llevar `Origin`: no se exige.
  if (!origin) return;

  const allowed = config.corsOrigins;
  if (allowed.includes('*') || allowed.includes(origin)) return;

  throw new ForbiddenException('Origen no permitido');
}
