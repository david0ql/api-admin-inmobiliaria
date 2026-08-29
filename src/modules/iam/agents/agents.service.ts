import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import * as argon2 from 'argon2';
import { QueryFailedError, Repository } from 'typeorm';
import { AppConfigService } from '../../../shared/config/app-config.service';
import { StorageService } from '../../media/storage.service';
import { Agent } from '../domain/agent.entity';
import { AgentShift } from '../domain/agent-shift.entity';
import { AgentStatus, Role, seesAllBranches } from '../domain/role.enum';
import {
  assertCanChangeRoleOrBranch,
  assertCanCreateAgent,
  assertCanEditAgent,
  resolveBranch,
} from '../scope';
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
    private readonly storage: StorageService,
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
    const qb = this.repo
      .createQueryBuilder('agent')
      .orderBy('agent.firstName', 'ASC');
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

  /**
   * La ficha de un usuario, con la sede por delante.
   *
   * `findById` no comprueba sede a proposito: lo usan la autenticacion —que
   * ocurre antes de que exista sede— y las asignaciones internas, que ya
   * comprueban con `assertSameBranch` justo despues. Pero la ruta del panel si
   * tiene que negarse: sin esto, un coordinador que supiera un identificador
   * leia el nombre, el correo y el telefono de alguien de otra oficina.
   *
   * Se responde 404 y no 403: confirmar que ese identificador existe ya es
   * decir algo de la otra sede.
   */
  async findVisible(id: string): Promise<Agent> {
    const agent = await this.findById(id);
    const branchId = RequestContext.branchId();

    if (branchId && agent.branchId && agent.branchId !== branchId) {
      throw new NotFoundException(`Asesor ${id} no encontrado`);
    }

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
     * El alta reparte acceso al sistema, asi que va por el mismo escalafon que
     * la edicion: la administracion crea a cualquiera; la direccion, a todo el
     * que este por debajo suyo en cualquier sede; quien manda en una sede,
     * solo asesores y perfiles de consulta. Si esto se dejara al formulario,
     * cualquiera con un `curl` se fabricaria un complice con mas rango que el.
     */
    if (actor) assertCanCreateAgent(actor, role);

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
    return sinSecreto(await this.repo.save(agent));
  }

  /**
   * Edita la ficha de una persona.
   *
   * Una sola puerta para los tres casos —la administracion editando a
   * cualquiera, quien manda en una sede editando a los suyos, y cada uno
   * editando lo suyo— porque son la misma operacion con distinto alcance.
   * Tener una ruta aparte para "mi perfil" seria tener dos sitios donde
   * comprobar lo mismo, y el dia que se toque uno solo, el otro es la fuga.
   */
  async update(id: string, dto: UpdateAgentDto): Promise<Agent> {
    const agent = await this.findById(id);
    const actor = RequestContext.actor();

    if (actor) {
      assertCanEditAgent(actor, agent);
      assertCanChangeRoleOrBranch(actor, agent, dto);

      /*
       * Nadie se da de baja ni se reactiva a si mismo: lo primero se hace sin
       * querer y deja a la persona fuera sin que nadie se entere, y lo segundo
       * convertiria una cuenta desactivada en reversible por su propio dueño.
       */
      if (actor.id === agent.id && dto.status && dto.status !== agent.status) {
        throw new ForbiddenException('No puedes cambiar tu propio estado');
      }
    }

    if (dto.email && dto.email.trim().toLowerCase() !== agent.email) {
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

    /*
     * El correo es la identidad para entrar, asi que su unicidad la sostiene
     * un indice y no la comprobacion de arriba: entre leer y guardar caben dos
     * peticiones a la vez. Cuando la carrera ocurre, el usuario tiene que leer
     * el mismo mensaje que si hubiera llegado el segundo, no un 500.
     */
    try {
      return sinSecreto(await this.repo.save(agent));
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new ConflictException(
          `Ya existe un asesor con el correo ${agent.email}`,
        );
      }
      throw err;
    }
  }

  /**
   * Escribe la contrasena. No comprueba permisos ni cierra sesiones a
   * proposito: quien puede y que arrastra el cambio lo decide `AuthService`,
   * que es quien tiene los refresh tokens delante.
   *
   * `mustChange` distingue los dos casos que llegan aqui. Si la persona eligio
   * su clave, la sabe solo ella y no hay nada pendiente. Si se la puso otro
   * —un restablecimiento—, esa clave la conocen dos, asi que la cuenta queda
   * obligada a cambiarla en el siguiente acceso: hasta entonces la API no le
   * deja hacer nada mas.
   */
  async setPassword(
    id: string,
    password: string,
    mustChange = false,
  ): Promise<void> {
    const agent = await this.findById(id);
    agent.passwordHash = await argon2.hash(password, { type: argon2.argon2id });
    agent.mustSetPassword = mustChange;
    await this.repo.save(agent);
  }

  /**
   * Cambia la foto de perfil.
   *
   * La imagen se recomprime y se guarda aqui —nunca se enlaza de fuera— y se
   * conserva la variante pequeña: el avatar se pinta a 96 px como mucho, asi
   * que servir la grande seria bajar medio megabyte para dibujar un circulo.
   */
  async setPhoto(id: string, file: Express.Multer.File): Promise<Agent> {
    const agent = await this.findById(id);
    const actor = RequestContext.actor();
    if (actor) assertCanEditAgent(actor, agent);

    if (!file?.buffer?.length) {
      throw new BadRequestException('No llego ninguna imagen');
    }

    const stored = await this.storage.saveImage(
      file.buffer,
      'agents',
      file.originalname,
    );
    agent.photoUrl = stored.url;
    return sinSecreto(await this.repo.save(agent));
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
    return sinSecreto(await this.repo.save(agent));
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

/**
 * La ficha sin el hash de la contrasena.
 *
 * `passwordHash` es `select: false`, asi que las CONSULTAS nunca lo traen. Las
 * escrituras si: `create` se lo pone a mano para guardarlo, y lo que devuelve
 * `save` es ese mismo objeto — con lo cual dar de alta a alguien respondia con
 * su hash de argon2 dentro. No sirve de mucho para entrar, pero es material
 * para atacarlo sin prisa y con el ordenador de otro, y no tiene ningun motivo
 * para salir del servidor.
 *
 * Se borra del objeto directamente: el que devuelve `save` es de usar y tirar,
 * TypeORM no lo reutiliza entre peticiones.
 */
function sinSecreto(agent: Agent): Agent {
  delete (agent as { passwordHash?: string | null }).passwordHash;
  return agent;
}

/**
 * Si el fallo es el indice unico del correo.
 *
 * El filtro global ya convierte un 23505 en un 409, pero con el nombre del
 * indice dentro: quien esta cambiando su correo no tiene por que leer
 * «IDX_5b0dfe...». Se distingue aqui para poder decirlo con palabras.
 */
function isUniqueViolation(err: unknown): boolean {
  return (
    err instanceof QueryFailedError &&
    (err.driverError as { code?: string } | undefined)?.code === '23505'
  );
}
