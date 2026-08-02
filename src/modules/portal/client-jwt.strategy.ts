import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { InjectRepository } from '@nestjs/typeorm';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { hkdfSync } from 'node:crypto';
import { Repository } from 'typeorm';
import { AppConfigService } from '../../shared/config/app-config.service';
import { Client } from '../crm/domain/client.entity';

/**
 * Identidad de un cliente en el portal. No es un `AuthenticatedActor`: no tiene
 * rol, no entra en el `RequestContext` y no puede acabar acotando una consulta
 * del CRM por error.
 */
export interface AuthenticatedClient {
  id: string;
  email: string;
  fullName: string;
  mustChangePassword: boolean;
}

/** Marca del tipo de sujeto, comprobada ademas de la firma. */
export const CLIENT_TOKEN_TYPE = 'client';
export const PORTAL_AUDIENCE = 'serrano:portal';
export const PORTAL_ISSUER = 'serrano:api';

export interface ClientTokenPayload {
  sub: string;
  typ: typeof CLIENT_TOKEN_TYPE;
}

/**
 * Claves del portal, derivadas de las de la plantilla con HKDF.
 *
 * Derivar y no reutilizar: un token de cliente firmado con la clave de los
 * asesores solo estaria separado por un claim, y un claim se olvida de
 * comprobar. Con claves distintas, un token del portal presentado en una ruta
 * del CRM ni siquiera pasa la verificacion de la firma — falla antes de que
 * ninguna logica pueda equivocarse.
 *
 * Derivar y no anadir dos secretos nuevos al entorno: un secreto mas es un
 * secreto mas que rotar, que copiar entre entornos y que alguien acaba dejando
 * con el valor de ejemplo.
 */
export function derivePortalSecret(base: string, info: string): string {
  return Buffer.from(
    hkdfSync('sha256', base, 'serrano-portal-v1', info, 32),
  ).toString('base64url');
}

@Injectable()
export class ClientJwtStrategy extends PassportStrategy(
  Strategy,
  'jwt-client',
) {
  constructor(
    config: AppConfigService,
    @InjectRepository(Client)
    private readonly clients: Repository<Client>,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: derivePortalSecret(config.jwt.accessSecret, 'access'),
      audience: PORTAL_AUDIENCE,
      issuer: PORTAL_ISSUER,
    });
  }

  /**
   * Se relee el cliente en cada peticion: revocarle el acceso desde el panel
   * surte efecto en la siguiente llamada, no cuando caduque el token.
   */
  async validate(payload: ClientTokenPayload): Promise<AuthenticatedClient> {
    if (payload.typ !== CLIENT_TOKEN_TYPE) {
      throw new UnauthorizedException('Token invalido');
    }

    const client = await this.clients.findOne({
      where: { id: payload.sub },
      loadEagerRelations: false,
      select: {
        id: true,
        firstName: true,
        lastName: true,
        email: true,
        portalEnabled: true,
        mustChangePassword: true,
      },
    });

    if (!client || !client.portalEnabled) {
      throw new UnauthorizedException('Cuenta inexistente o sin acceso');
    }

    return {
      id: client.id,
      email: client.email ?? '',
      fullName: client.fullName,
      mustChangePassword: client.mustChangePassword,
    };
  }
}
