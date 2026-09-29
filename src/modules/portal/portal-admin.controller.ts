import {
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Patch,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ActivitiesService } from '../activity/activities.service';
import { ActivityType } from '../activity/domain/activity.entity';
import { Client } from '../crm/domain/client.entity';
import { CurrentUser, Roles } from '../iam/decorators';
import { Role } from '../iam/domain/role.enum';
import type { AuthenticatedActor } from '../../shared/request-context/request-context';
import { ClientsService } from '../crm/clients.service';
import { PortalAuthService } from './portal-auth.service';
import { PortalAccessDto } from './dto/portal.dto';

/**
 * El acceso al portal visto desde el panel.
 *
 * Va en este modulo y no en el de CRM por una razon prosaica: `PortalModule` ya
 * depende de `CrmModule`, y ponerlo al reves cerraria el ciclo.
 *
 * Fijar una clave queda anotado en la bitacora del cliente. Dar acceso a la
 * ficha de alguien es una decision con consecuencias —quien la tenga vera sus
 * inmuebles y sus visitas— y tiene que constar quien la tomo.
 */
@ApiTags('crm')
@Controller('clients')
export class PortalAdminController {
  constructor(
    @InjectRepository(Client) private readonly clients: Repository<Client>,
    // Para leer un cliente: trae la sede y la cartera puestas.
    private readonly clientsService: ClientsService,
    private readonly auth: PortalAuthService,
    private readonly activities: ActivitiesService,
  ) {}

  @Get(':id/portal')
  @Roles(Role.ADMIN, Role.MANAGER, Role.AGENT)
  @ApiOperation({ summary: 'Estado del acceso al portal de este cliente' })
  async status(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: AuthenticatedActor,
  ) {
    const client = await this.find(id, actor);
    // Nunca el hash, ni siquiera a un administrador: no hay nada que hacer con
    // el desde el panel, y lo que no se envia no se filtra.
    return {
      hasPassword: Boolean(await this.hasPassword(id)),
      portalEnabled: client.portalEnabled,
      mustChangePassword: client.mustChangePassword,
      selfRegistered: client.selfRegistered,
      lastPortalLoginAt: client.lastPortalLoginAt,
      email: client.email,
    };
  }

  @Patch(':id/portal')
  @Roles(Role.ADMIN, Role.MANAGER, Role.AGENT)
  @ApiOperation({
    summary: 'Da, revoca o restablece el acceso al portal',
    description:
      'Fijar una clave la marca como provisional: el cliente tendrá que ' +
      'cambiarla en su primera entrada, porque una contraseña dictada por ' +
      'teléfono no es un secreto.',
  })
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: PortalAccessDto,
    @CurrentUser() actor: AuthenticatedActor,
  ) {
    const client = await this.find(id, actor);

    if (!client.email) {
      throw new NotFoundException(
        'Este cliente no tiene correo, y el correo es con lo que entra al portal',
      );
    }

    if (dto.password) {
      await this.auth.setPasswordFromStaff(id, dto.password);
      await this.activities.record({
        type: ActivityType.NOTE,
        clientId: id,
        agentId: actor.id,
        summary: 'Acceso al portal: contraseña restablecida',
        detail: `${actor.fullName} le fijó una contraseña provisional. El cliente debe cambiarla al entrar.`,
        automatic: true,
      });
    }

    if (dto.enabled !== undefined) {
      await this.auth.setPortalEnabled(id, dto.enabled);
      await this.activities.record({
        type: ActivityType.NOTE,
        clientId: id,
        agentId: actor.id,
        summary: dto.enabled
          ? 'Acceso al portal habilitado'
          : 'Acceso al portal revocado',
        detail:
          `${actor.fullName} ${dto.enabled ? 'habilitó' : 'revocó'} el acceso. ${
            dto.enabled ? '' : 'Sus sesiones abiertas se cerraron.'
          }`.trim(),
        automatic: true,
      });
    }

    return this.status(id, actor);
  }

  /**
   * El cliente, acotado a quien pregunta.
   *
   * Esto era un `findOne` por id contra el repositorio, sin sede y sin cartera,
   * y abria un agujero de verdad: cualquiera con acceso al panel —asesor
   * incluido— podia leer el estado del portal de CUALQUIER cliente del sistema
   * y, peor, fijarle una contraseña provisional y entrar al portal como el.
   * Bastaba con conocer su identificador.
   *
   * `ClientsService.findOne` ya resuelve las dos cosas: filtra por sede y por
   * cartera, y contesta 404 —no 403— a lo que no alcanza, que es lo correcto:
   * a quien no puede verlo tampoco se le confirma que exista.
   */
  private async find(id: string, actor: AuthenticatedActor): Promise<Client> {
    return this.clientsService.findOne(id, actor);
  }

  /** Solo se llama DESPUES de que `find` haya comprobado el alcance. */
  private async hasPassword(id: string): Promise<boolean> {
    const row = await this.clients
      .createQueryBuilder('client')
      .select('client.passwordHash')
      .where('client.id = :id', { id })
      .getOne();
    return Boolean(row?.passwordHash);
  }
}
