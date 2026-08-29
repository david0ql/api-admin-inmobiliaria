import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { TypeOrmModule } from '@nestjs/typeorm';
import { MediaModule } from '../media/media.module';
import { Agent } from './domain/agent.entity';
import { AgentShift } from './domain/agent-shift.entity';
import { RefreshToken } from './domain/refresh-token.entity';
import { AgentsService } from './agents/agents.service';
import { AgentsController } from './agents/agents.controller';
import { AuthService } from './auth/auth.service';
import { AuthController } from './auth/auth.controller';
import { JwtStrategy } from './auth/jwt.strategy';

@Module({
  imports: [
    TypeOrmModule.forFeature([Agent, AgentShift, RefreshToken]),
    PassportModule.register({ defaultStrategy: 'jwt' }),
    // Los secretos se pasan por operacion: acceso y refresco usan claves distintas.
    JwtModule.register({}),
    // Para la foto de perfil: se recomprime y se guarda aqui, como las del
    // inventario.
    MediaModule,
  ],
  controllers: [AuthController, AgentsController],
  providers: [AgentsService, AuthService, JwtStrategy],
  exports: [AgentsService, AuthService, TypeOrmModule],
})
export class IamModule {}
