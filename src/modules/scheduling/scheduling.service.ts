import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, Repository } from 'typeorm';
import { Paginated } from '../../shared/http/paginated';
import { ActivitiesService } from '../activity/activities.service';
import { Activity, ActivityType } from '../activity/domain/activity.entity';
import { AgentsService } from '../iam/agents/agents.service';
import {
  applyOwnershipScope,
  assertCanMutate,
  resolveOwner,
} from '../iam/scope';
import { ClientsService } from '../crm/clients.service';
import { PropertiesService } from '../properties/properties.service';
import type { AuthenticatedActor } from '../../shared/request-context/request-context';
import {
  Appointment,
  AppointmentStatus,
  AppointmentType,
} from './domain/appointment.entity';
import type {
  CalendarQueryDto,
  CloseAppointmentDto,
  CreateAppointmentDto,
  SearchAppointmentsDto,
  UpdateAppointmentDto,
} from './scheduling.dto';

/** Estados en los que la cita todavia ocupa la agenda del asesor. */
const BLOCKING_STATUSES = [
  AppointmentStatus.SCHEDULED,
  AppointmentStatus.CONFIRMED,
];

export interface CalendarDay {
  date: string;
  appointments: Appointment[];
}

@Injectable()
export class SchedulingService {
  constructor(
    @InjectRepository(Appointment)
    private readonly repo: Repository<Appointment>,
    private readonly agents: AgentsService,
    private readonly clients: ClientsService,
    private readonly properties: PropertiesService,
    private readonly activities: ActivitiesService,
  ) {}

  // --- lectura -----------------------------------------------------------

  async search(
    dto: SearchAppointmentsDto,
    actor: AuthenticatedActor,
  ): Promise<Paginated<Appointment>> {
    const qb = this.repo
      .createQueryBuilder('appointment')
      .leftJoinAndSelect('appointment.agent', 'agent')
      .leftJoinAndSelect('appointment.client', 'client')
      .leftJoinAndSelect('appointment.property', 'property');

    if (dto.from)
      qb.andWhere('appointment.starts_at >= :from', { from: dto.from });
    if (dto.to)
      qb.andWhere('appointment.starts_at <= :to', { to: endOfDay(dto.to) });
    if (dto.agentId)
      qb.andWhere('appointment.agent_id = :agentId', { agentId: dto.agentId });
    if (dto.clientId)
      qb.andWhere('appointment.client_id = :clientId', {
        clientId: dto.clientId,
      });
    if (dto.propertyId) {
      qb.andWhere('appointment.property_id = :propertyId', {
        propertyId: dto.propertyId,
      });
    }
    if (dto.status)
      qb.andWhere('appointment.status = :status', { status: dto.status });
    if (dto.type) qb.andWhere('appointment.type = :type', { type: dto.type });

    applyOwnershipScope(qb, actor, 'appointment.agent_id');
    qb.orderBy('appointment.starts_at', 'ASC');

    const [data, total] = await qb
      .skip(dto.skip)
      .take(dto.limit)
      .getManyAndCount();
    return new Paginated(data, total, dto.page, dto.limit);
  }

  async findOne(id: string, actor: AuthenticatedActor): Promise<Appointment> {
    const qb = this.repo
      .createQueryBuilder('appointment')
      .leftJoinAndSelect('appointment.agent', 'agent')
      .leftJoinAndSelect('appointment.client', 'client')
      .leftJoinAndSelect('appointment.property', 'property')
      .where('appointment.id = :id', { id });
    applyOwnershipScope(qb, actor, 'appointment.agent_id');

    const appointment = await qb.getOne();
    if (!appointment) throw new NotFoundException(`Cita ${id} no encontrada`);
    return appointment;
  }

  /**
   * Vista de calendario: citas agrupadas por dia dentro del rango, mas los
   * turnos del equipo. El frontend pinta el mes con una sola llamada.
   */
  async calendar(
    dto: CalendarQueryDto,
    actor: AuthenticatedActor,
  ): Promise<{ days: CalendarDay[]; shifts: unknown[] }> {
    const from = new Date(dto.from);
    const to = new Date(endOfDay(dto.to));
    if (from > to)
      throw new BadRequestException('`from` debe ser anterior a `to`');
    if (to.getTime() - from.getTime() > 366 * 24 * 3600 * 1000) {
      throw new BadRequestException(
        'El rango del calendario no puede superar un ano',
      );
    }

    const qb = this.repo
      .createQueryBuilder('appointment')
      .leftJoinAndSelect('appointment.agent', 'agent')
      .leftJoinAndSelect('appointment.client', 'client')
      .leftJoinAndSelect('appointment.property', 'property')
      .where('appointment.starts_at BETWEEN :from AND :to', { from, to })
      .andWhere('appointment.status != :canceled', {
        canceled: AppointmentStatus.CANCELED,
      });

    if (dto.agentId)
      qb.andWhere('appointment.agent_id = :agentId', { agentId: dto.agentId });
    applyOwnershipScope(qb, actor, 'appointment.agent_id');

    const appointments = await qb
      .orderBy('appointment.starts_at', 'ASC')
      .getMany();

    const byDay = new Map<string, Appointment[]>();
    for (const appointment of appointments) {
      const key = appointment.startsAt.toISOString().slice(0, 10);
      const bucket = byDay.get(key);
      if (bucket) bucket.push(appointment);
      else byDay.set(key, [appointment]);
    }

    const shifts = dto.agentId ? await this.agents.listShifts(dto.agentId) : [];

    return {
      days: [...byDay.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([date, items]) => ({ date, appointments: items })),
      shifts,
    };
  }

  /** Bitacora unificada del cliente: actividades y citas en un solo hilo. */
  async timelineForClient(clientId: string, limit = 100) {
    if (!(await this.clients.exists(clientId))) {
      throw new NotFoundException(`Cliente ${clientId} no encontrado`);
    }

    const [activities, appointments] = await Promise.all([
      this.activities.listForClient(clientId, limit),
      this.repo.find({
        where: { clientId },
        order: { startsAt: 'DESC' },
        take: limit,
      }),
    ]);

    const entries = [
      ...activities.map((a: Activity) => ({
        kind: 'activity' as const,
        at: a.occurredAt,
        id: a.id,
        type: a.type,
        summary: a.summary,
        detail: a.detail,
        agentId: a.agentId,
        automatic: a.automatic,
      })),
      ...appointments.map((a) => ({
        kind: 'appointment' as const,
        at: a.startsAt,
        id: a.id,
        type: a.type,
        summary: a.title,
        detail: a.outcome ?? a.notes,
        agentId: a.agentId,
        status: a.status,
        propertyId: a.propertyId,
      })),
    ].sort((a, b) => b.at.getTime() - a.at.getTime());

    return entries.slice(0, limit);
  }

  // --- escritura ---------------------------------------------------------

  async create(
    dto: CreateAppointmentDto,
    actor: AuthenticatedActor,
  ): Promise<Appointment> {
    const agentId = resolveOwner(actor, dto.agentId);
    await this.agents.findById(agentId);

    const startsAt = new Date(dto.startsAt);
    const endsAt = new Date(dto.endsAt);
    this.assertValidRange(startsAt, endsAt);

    if (dto.clientId && !(await this.clients.exists(dto.clientId))) {
      throw new NotFoundException(`Cliente ${dto.clientId} no encontrado`);
    }
    if (dto.propertyId && !(await this.properties.exists(dto.propertyId))) {
      throw new NotFoundException(`Inmueble ${dto.propertyId} no encontrado`);
    }

    if (!dto.force) {
      await this.assertNoOverlap(agentId, startsAt, endsAt);
      await this.assertWithinShift(agentId, startsAt);
    }

    const appointment = await this.repo.save(
      this.repo.create({
        title: dto.title,
        type: dto.type ?? AppointmentType.VISIT,
        status: AppointmentStatus.SCHEDULED,
        startsAt,
        endsAt,
        agentId,
        clientId: dto.clientId ?? null,
        propertyId: dto.propertyId ?? null,
        location: dto.location ?? null,
        notes: dto.notes ?? null,
      }),
    );

    if (dto.clientId) await this.clients.touchContact(dto.clientId);
    return appointment;
  }

  async update(
    id: string,
    dto: UpdateAppointmentDto,
    actor: AuthenticatedActor,
  ): Promise<Appointment> {
    // Sin `loadEagerRelations: false` los objetos `agent`, `client` y
    // `property` cargados prevalecerian sobre las claves foraneas al guardar.
    const appointment = await this.repo.findOne({
      where: { id },
      loadEagerRelations: false,
    });
    if (!appointment) throw new NotFoundException(`Cita ${id} no encontrada`);
    assertCanMutate(actor, appointment.agentId, 'esta cita');

    const startsAt = dto.startsAt
      ? new Date(dto.startsAt)
      : appointment.startsAt;
    const endsAt = dto.endsAt ? new Date(dto.endsAt) : appointment.endsAt;
    const agentId = dto.agentId ?? appointment.agentId;

    if (dto.startsAt || dto.endsAt) this.assertValidRange(startsAt, endsAt);
    if (dto.agentId && dto.agentId !== appointment.agentId) {
      resolveOwner(actor, dto.agentId);
      await this.agents.findById(dto.agentId);
    }

    const reschedules = dto.startsAt || dto.endsAt || dto.agentId;
    if (reschedules && !dto.force) {
      await this.assertNoOverlap(agentId, startsAt, endsAt, id);
      await this.assertWithinShift(agentId, startsAt);
    }

    Object.assign(appointment, {
      ...dto,
      startsAt,
      endsAt,
      agentId,
      clientId: dto.clientId ?? appointment.clientId,
      propertyId: dto.propertyId ?? appointment.propertyId,
    });

    await this.repo.save(appointment);
    return this.findOne(id, actor);
  }

  /**
   * Cierra la cita y deja constancia en la bitacora del cliente: una visita sin
   * resultado registrado es informacion perdida.
   */
  async close(
    id: string,
    dto: CloseAppointmentDto,
    actor: AuthenticatedActor,
  ): Promise<Appointment> {
    const appointment = await this.repo.findOne({ where: { id } });
    if (!appointment) throw new NotFoundException(`Cita ${id} no encontrada`);
    assertCanMutate(actor, appointment.agentId, 'esta cita');

    const allowed = [
      AppointmentStatus.DONE,
      AppointmentStatus.NO_SHOW,
      AppointmentStatus.CANCELED,
    ];
    if (!allowed.includes(dto.status)) {
      throw new BadRequestException(
        `Para cerrar una cita usa uno de: ${allowed.join(', ')}`,
      );
    }

    appointment.status = dto.status;
    appointment.outcome = dto.outcome ?? appointment.outcome;
    const saved = await this.repo.save(appointment);

    if (appointment.clientId) {
      const label = {
        [AppointmentStatus.DONE]: 'realizada',
        [AppointmentStatus.NO_SHOW]: 'sin asistencia del cliente',
        [AppointmentStatus.CANCELED]: 'cancelada',
      }[
        dto.status as
          | AppointmentStatus.DONE
          | AppointmentStatus.NO_SHOW
          | AppointmentStatus.CANCELED
      ];

      await this.activities.record({
        type:
          appointment.type === AppointmentType.VISIT
            ? ActivityType.VISIT
            : ActivityType.NOTE,
        clientId: appointment.clientId,
        propertyId: appointment.propertyId,
        agentId: actor.id,
        summary: `${appointment.title} — ${label}`,
        detail: dto.outcome ?? null,
        occurredAt: appointment.startsAt,
      });
      await this.clients.touchContact(appointment.clientId);
    }

    return saved;
  }

  async remove(id: string, actor: AuthenticatedActor): Promise<void> {
    const appointment = await this.repo.findOne({ where: { id } });
    if (!appointment) throw new NotFoundException(`Cita ${id} no encontrada`);
    assertCanMutate(actor, appointment.agentId, 'esta cita');
    await this.repo.softDelete(id);
  }

  /** Agenda del dia del asesor: lo primero que mira al llegar. */
  async agenda(agentId: string, day: string): Promise<Appointment[]> {
    const from = new Date(`${day}T00:00:00.000Z`);
    const to = new Date(`${day}T23:59:59.999Z`);
    return this.repo.find({
      where: { agentId, startsAt: Between(from, to) },
      order: { startsAt: 'ASC' },
    });
  }

  // --- reglas ------------------------------------------------------------

  private assertValidRange(startsAt: Date, endsAt: Date): void {
    if (Number.isNaN(startsAt.getTime()) || Number.isNaN(endsAt.getTime())) {
      throw new BadRequestException('Fechas invalidas');
    }
    if (endsAt <= startsAt) {
      throw new BadRequestException('La cita debe terminar despues de empezar');
    }
    if (endsAt.getTime() - startsAt.getTime() > 12 * 3600 * 1000) {
      throw new BadRequestException('Una cita no puede durar mas de 12 horas');
    }
  }

  /** Dos citas del mismo asesor no pueden pisarse. */
  private async assertNoOverlap(
    agentId: string,
    startsAt: Date,
    endsAt: Date,
    excludeId?: string,
  ): Promise<void> {
    const qb = this.repo
      .createQueryBuilder('appointment')
      .where('appointment.agent_id = :agentId', { agentId })
      .andWhere('appointment.status IN (:...statuses)', {
        statuses: BLOCKING_STATUSES,
      })
      // Solapan si empieza antes de que acabe la otra y acaba despues de que empiece.
      .andWhere(
        'appointment.starts_at < :endsAt AND appointment.ends_at > :startsAt',
        {
          startsAt,
          endsAt,
        },
      );
    if (excludeId) qb.andWhere('appointment.id != :excludeId', { excludeId });

    const clash = await qb.getOne();
    if (clash) {
      throw new ConflictException(
        `El asesor ya tiene "${clash.title}" de ${fmt(clash.startsAt)} a ${fmt(clash.endsAt)}. Usa force:true si aun asi quieres agendarla.`,
      );
    }
  }

  /** Avisa si la cita cae fuera del cuadro de turnos, salvo que no haya turnos. */
  private async assertWithinShift(
    agentId: string,
    startsAt: Date,
  ): Promise<void> {
    if ((await this.agents.countShifts()) === 0) return;
    const covering = await this.agents.shiftsCovering(agentId, startsAt);
    if (!covering.length) {
      throw new ConflictException(
        `${fmt(startsAt)} queda fuera del turno del asesor. Usa force:true para agendarla igualmente.`,
      );
    }
  }
}

function endOfDay(date: string): string {
  return date.includes('T') ? date : `${date}T23:59:59.999Z`;
}

function fmt(date: Date): string {
  return date.toISOString().replace('T', ' ').slice(0, 16);
}
