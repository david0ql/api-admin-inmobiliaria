import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { AppConfigService } from '../../../shared/config/app-config.service';
import { AgentsService } from '../agents/agents.service';
import { AgentStatus } from '../domain/role.enum';
import type { AuthenticatedActor } from '../../../shared/request-context/request-context';

export interface AccessTokenPayload {
  sub: string;
  email: string;
  role: string;
  name: string;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(
    config: AppConfigService,
    private readonly agents: AgentsService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.jwt.accessSecret,
    });
  }

  /**
   * Se relee el asesor en cada peticion: si se le desactiva o se le cambia el
   * rol, el efecto es inmediato y no hay que esperar a que caduque el token.
   */
  async validate(payload: AccessTokenPayload): Promise<AuthenticatedActor> {
    const agent = await this.agents.findByIdOrNull(payload.sub);
    if (!agent || agent.status !== AgentStatus.ACTIVE) {
      throw new UnauthorizedException('Cuenta inexistente o desactivada');
    }
    return {
      id: agent.id,
      email: agent.email,
      role: agent.role,
      fullName: agent.fullName,
      mustSetPassword: agent.mustSetPassword,
    };
  }
}
