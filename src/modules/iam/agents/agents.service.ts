import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import * as argon2 from 'argon2';
import { Repository } from 'typeorm';
import { AppConfigService } from '../../../shared/config/app-config.service';
import { Agent } from '../domain/agent.entity';
import { AgentShift } from '../domain/agent-shift.entity';
import { AgentStatus, Role, seesAllBranches } from '../domain/role.enum';
import { resolveBranch } from '../scope';
import { RequestContext } from '../../../shared/request-context/request-context';
import type { CreateAgentDto, UpdateAgentDto } from './agents.dto';
import type { SetShiftsDto } from './shifts.dto';

@Injectable()
export class AgentsService {
  constructor(
    @InjectRepository(Agent) private readonly repo: Repository<Agent>,
    @InjectRepository(AgentShift)
    private readonly shifts: Repository<AgentShift>,
    private readonly config: AppConfigService,
  ) {}

  /**
   * El equipo visible.
   *
   * Filtra por la sede de la peticion —la del selector para quien ve varias,
   * la propia para el resto— porque un coordinador de Bucaramanga no tiene por
   * que saber quien trabaja en Bogota. Quien no tiene sede (ADMIN, DIRECTOR)
   * aparece siempre: manda sobre todas, asi que no pertenece a ninguna y
   * esconderlo dejaria al administrador fuera de su propio listado.
   */
  async findAll(includeInactive = false): Promise<Agent[]> {
    const qb = this.repo.createQueryBuilder('agent').orderBy('agent.firstName', 'ASC');
    if (!includeInactive) {
      qb.andWhere('agent.status = :status', { status: AgentStatus.ACTIVE });
    }
    const branchId = RequestContext.branchId();
    if (branchId) {
      qb.andWhere('(agent.branchId = :branchId OR agent.branchId IS NULL)', {
        branchId,
      });
    }
    return qb.getMany();
  }

  async findByIdOrNull(id: string): Promise<Agent | null> {
    return this.repo.findOne({ where: { id } });
  }

  async findById(id: string): Promise<Agent> {
    const agent = await this.findByIdOrNull(id);
    if (!agent) throw new NotFoundException(`Asesor ${id} no encontrado`);
    return agent;
  }

  /** Incluye el hash de contrasena, excluido por defecto del select. */
  async findByEmailWithSecret(email: string): Promise<Agent | null> {
    return this.repo
      .createQueryBuilder('agent')
      .addSelect('agent.passwordHash')
      .where('LOWER(agent.email) = LOWER(:email)', { email })
      .getOne();
  }

  async create(dto: CreateAgentDto): Promise<Agent> {
    const email = dto.email.trim().toLowerCase();
    if (await this.repo.findOne({ where: { email } })) {
      throw new ConflictException(`Ya existe un asesor con el correo ${email}`);
    }

    const role = dto.role ?? Role.AGENT;
    const actor = RequestContext.actor();

    /*
     * La direccion mira, no reparte cuentas. Ve las cuatro sedes y su cartera
     * entera, pero dar de alta usuarios es administrar el sistema — y eso es
     * del ADMIN, o del coordinador dentro de su oficina.
     */
    if (actor?.role === Role.DIRECTOR) {
      throw new ForbiddenException(
        'La dirección no da de alta usuarios: pídeselo a la administración',
      );
    }

    /*
     * Quien manda en una sola sede da de alta a los suyos, y solo a los suyos:
     * ni administradores, ni directores, ni otro coordinador. Si esto se
     * dejara al formulario, cualquiera con un `curl` se ascenderia a si mismo
     * creando un ADMIN.
     */
    if (actor && !seesAllBranches(actor.role as Role)) {
      if (role !== Role.AGENT && role !== Role.VIEWER) {
        throw new ForbiddenException(
          'Desde una sede solo se dan de alta asesores y perfiles de consulta',
        );
      }
    }

    // ADMIN y DIRECTOR no cuelgan de ninguna sede; el resto siempre de una, y
    // `resolveBranch` decide cual (la propia, o la elegida si se ven todas).
    const branchId = seesAllBranches(role)
      ? null
      : actor
        ? resolveBranch(actor, dto.branchId)
        : (dto.branchId ?? null);

    const agent = this.repo.create({
      ...dto,
      role,
      branchId,
      email,
      // Sin contrasena explicita se usa la clave generica de la agencia: el
      // asesor entra con ella, pero la API le exige cambiarla antes de nada.
      passwordHash: await argon2.hash(
        dto.password ?? this.config.defaultUserPassword,
        { type: argon2.argon2id },
      ),
      mustSetPassword: !dto.password,
    });
    return this.repo.save(agent);
  }

  async update(id: string, dto: UpdateAgentDto): Promise<Agent> {
    const agent = await this.findById(id);

    /*
     * Las mismas dos barreras que al crear, porque editar es la otra puerta a
     * lo mismo: un coordinador no asciende a nadie ni se lleva a un asesor a
     * otra oficina.
     */
    const actor = RequestContext.actor();
    if (actor?.role === Role.DIRECTOR) {
      throw new ForbiddenException(
        'La dirección no edita usuarios: pídeselo a la administración',
      );
    }
    if (actor && !seesAllBranches(actor.role as Role)) {
      // Tampoco sobre un igual o un superior: si el usuario editado no es
      // asesor ni consulta, no es suyo aunque comparta oficina.
      if (agent.role !== Role.AGENT && agent.role !== Role.VIEWER) {
        throw new ForbiddenException(
          'Solo puedes editar asesores y perfiles de consulta de tu sede',
        );
      }
      if (dto.role && dto.role !== Role.AGENT && dto.role !== Role.VIEWER) {
        throw new ForbiddenException(
          'Desde una sede solo se asignan perfiles de asesor o consulta',
        );
      }
      if (dto.branchId && dto.branchId !== actor.branchId) {
        throw new ForbiddenException('No puedes mover usuarios a otra sede');
      }
      if (agent.branchId && agent.branchId !== actor.branchId) {
        throw new ForbiddenException('Ese usuario pertenece a otra sede');
      }
    }
    if (dto.email && dto.email.toLowerCase() !== agent.email) {
      const email = dto.email.trim().toLowerCase();
      if (await this.repo.findOne({ where: { email } })) {
        throw new ConflictException(
          `Ya existe un asesor con el correo ${email}`,
        );
      }
      agent.email = email;
    }
    Object.assign(agent, {
      ...dto,
      email: agent.email,
      // La sede solo cambia si viene explicita: `undefined` en el DTO no debe
      // dejar al usuario sin oficina.
      branchId: dto.branchId ?? agent.branchId,
    });
    return this.repo.save(agent);
  }

  async setPassword(id: string, password: string): Promise<void> {
    const agent = await this.findById(id);
    agent.passwordHash = await argon2.hash(password, { type: argon2.argon2id });
    agent.mustSetPassword = false;
    await this.repo.save(agent);
  }

  async deactivate(id: string): Promise<Agent> {
    const agent = await this.findById(id);
    if (agent.role === Role.ADMIN) {
      const activeAdmins = await this.repo.count({
        where: { role: Role.ADMIN, status: AgentStatus.ACTIVE },
      });
      if (activeAdmins <= 1) {
        throw new BadRequestException(
          'No puedes desactivar al ultimo administrador activo',
        );
      }
    }
    agent.status = AgentStatus.INACTIVE;
    return this.repo.save(agent);
  }

  async touchLogin(id: string): Promise<void> {
    await this.repo.update({ id }, { lastLoginAt: new Date() });
  }

  // --- turnos y guardias -------------------------------------------------

  async listShifts(agentId: string): Promise<AgentShift[]> {
    await this.findById(agentId);
    return this.shifts.find({
      where: { agentId },
      order: { weekday: 'ASC', startTime: 'ASC' },
    });
  }

  /** Reemplaza el cuadro de turnos completo del asesor (operacion idempotente). */
  async replaceShifts(
    agentId: string,
    dto: SetShiftsDto,
  ): Promise<AgentShift[]> {
    await this.findById(agentId);
    for (const shift of dto.shifts) {
      if (shift.startTime >= shift.endTime) {
        throw new BadRequestException(
          `Turno invalido el dia ${shift.weekday}: ${shift.startTime} no es anterior a ${shift.endTime}`,
        );
      }
    }
    await this.shifts.delete({ agentId });
    if (!dto.shifts.length) return [];
    const created = this.shifts.create(
      dto.shifts.map((s) => ({ ...s, agentId })),
    );
    return this.shifts.save(created);
  }

  /** Turnos que cubren un instante dado; lo usa el agendamiento de citas. */
  async shiftsCovering(agentId: string, at: Date): Promise<AgentShift[]> {
    const weekday = at.getUTCDay();
    const time = at.toISOString().slice(11, 19);
    const date = at.toISOString().slice(0, 10);
    return this.shifts
      .createQueryBuilder('shift')
      .where('shift.agent_id = :agentId', { agentId })
      .andWhere('shift.weekday = :weekday', { weekday })
      .andWhere('shift.start_time <= :time AND shift.end_time > :time', {
        time,
      })
      .andWhere('(shift.valid_from IS NULL OR shift.valid_from <= :date)', {
        date,
      })
      .andWhere('(shift.valid_until IS NULL OR shift.valid_until >= :date)', {
        date,
      })
      .getMany();
  }

  async countShifts(): Promise<number> {
    return this.shifts.count();
  }
}
