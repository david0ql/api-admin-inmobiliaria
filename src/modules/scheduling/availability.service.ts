import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Agent } from '../iam/domain/agent.entity';
import { AgentShift } from '../iam/domain/agent-shift.entity';
import { AgentStatus, Role } from '../iam/domain/role.enum';
import { Appointment, AppointmentStatus } from './domain/appointment.entity';

export interface Slot {
  /** Instante de inicio en ISO/UTC. */
  startsAt: string;
  endsAt: string;
  /** Cuántos asesores pueden atender esta franja. */
  agents: number;
}

export interface DayAvailability {
  date: string;
  weekday: number;
  /** Hay al menos un asesor con hueco ese día. */
  available: boolean;
  slots: Slot[];
}

/** Estados en los que la cita sigue ocupando la agenda del asesor. */
const BLOCKING = [AppointmentStatus.SCHEDULED, AppointmentStatus.CONFIRMED];

/** Duración de una visita y paso de la rejilla, en minutos. */
const SLOT_MINUTES = 60;

/**
 * Disponibilidad del equipo para agendar visitas desde fuera.
 *
 * La pregunta que resuelve no es "¿está libre este asesor?" sino "¿queda
 * alguien que pueda atender esta visita?". Un comprador que entra en la ficha
 * de un inmueble no conoce ni le importa el reparto interno: quiere ver qué
 * días hay hueco y reservar. El asesor se asigna después, y se elige al que
 * menos carga tenga ese día.
 */
@Injectable()
export class AvailabilityService {
  constructor(
    @InjectRepository(Agent) private readonly agents: Repository<Agent>,
    @InjectRepository(AgentShift)
    private readonly shifts: Repository<AgentShift>,
    @InjectRepository(Appointment)
    private readonly appointments: Repository<Appointment>,
  ) {}

  /**
   * Días con hueco en un rango.
   *
   * `minLeadHours` respeta la regla de la agencia de pedir la visita con un día
   * de antelación: nada de reservas para dentro de diez minutos.
   */
  async calendar(
    from: string,
    to: string,
    {
      minLeadHours = 24,
      propertyAgentId,
    }: { minLeadHours?: number; propertyAgentId?: string } = {},
  ): Promise<DayAvailability[]> {
    const start = startOfDay(from);
    const end = endOfDay(to);

    if (
      Number.isNaN(start.getTime()) ||
      Number.isNaN(end.getTime()) ||
      start > end
    ) {
      throw new BadRequestException('Rango de fechas invalido');
    }
    if (end.getTime() - start.getTime() > 92 * 24 * 3600 * 1000) {
      throw new BadRequestException('El rango no puede superar tres meses');
    }

    const team = await this.agents.find({
      where: { status: AgentStatus.ACTIVE },
      select: { id: true, role: true },
    });
    // Los perfiles de solo lectura no atienden visitas.
    const eligible = team.filter((agent) => agent.role !== Role.VIEWER);
    if (!eligible.length) return [];

    const agentIds = eligible.map((agent) => agent.id);
    const shifts = await this.shifts.find({
      where: agentIds.map((agentId) => ({ agentId })),
    });

    // Sin cuadro de turnos no se puede afirmar que alguien esté libre: se
    // asume la jornada estándar de la oficina en lugar de devolver "nada
    // disponible", que dejaría el formulario público inservible.
    const byAgent = new Map<string, AgentShift[]>();
    for (const agentId of agentIds) {
      const own = shifts.filter((shift) => shift.agentId === agentId);
      byAgent.set(agentId, own.length ? own : DEFAULT_SHIFTS(agentId));
    }

    const booked = await this.appointments
      .createQueryBuilder('appointment')
      .select([
        'appointment.agentId',
        'appointment.startsAt',
        'appointment.endsAt',
      ])
      .where('appointment.agent_id IN (:...agentIds)', { agentIds })
      .andWhere('appointment.status IN (:...statuses)', { statuses: BLOCKING })
      .andWhere(
        'appointment.starts_at < :end AND appointment.ends_at > :start',
        { start, end },
      )
      .getMany();

    const notBefore = new Date(Date.now() + minLeadHours * 3600 * 1000);
    const days: DayAvailability[] = [];

    for (
      let day = new Date(start);
      day <= end;
      day.setUTCDate(day.getUTCDate() + 1)
    ) {
      const date = day.toISOString().slice(0, 10);
      const weekday = day.getUTCDay();
      const slots = new Map<string, Set<string>>();

      for (const agentId of agentIds) {
        for (const shift of byAgent.get(agentId) ?? []) {
          if (shift.weekday !== weekday) continue;
          if (shift.validFrom && shift.validFrom > date) continue;
          if (shift.validUntil && shift.validUntil < date) continue;

          for (const slot of gridOf(date, shift.startTime, shift.endTime)) {
            if (slot.start < notBefore) continue;
            const busy = booked.some(
              (appointment) =>
                appointment.agentId === agentId &&
                appointment.startsAt < slot.end &&
                appointment.endsAt > slot.start,
            );
            if (busy) continue;

            const key = slot.start.toISOString();
            const set = slots.get(key) ?? new Set<string>();
            set.add(agentId);
            slots.set(key, set);
          }
        }
      }

      const list: Slot[] = [...slots.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([startsAt, agents]) => ({
          startsAt,
          endsAt: new Date(
            new Date(startsAt).getTime() + SLOT_MINUTES * 60_000,
          ).toISOString(),
          agents: agents.size,
        }));

      days.push({ date, weekday, available: list.length > 0, slots: list });
    }

    // Si el inmueble ya tiene asesor, sus huecos se marcan primero: es quien
    // conoce la unidad.
    if (propertyAgentId) {
      for (const day of days) {
        day.slots.sort(
          (a, b) => b.agents - a.agents || a.startsAt.localeCompare(b.startsAt),
        );
      }
    }

    return days;
  }

  /**
   * Elige quién atiende una franja: de los libres, el que menos citas tenga
   * ese día. Reparte la carga sin necesidad de que nadie la administre.
   * Devuelve null si a esa hora ya no queda nadie.
   */
  /**
   * Si un asesor sigue libre en una franja, ignorando una cita concreta.
   *
   * `exceptId` es la cita que se esta moviendo: sin eso choca consigo misma.
   */
  async isAgentFree(
    agentId: string | null,
    startsAt: Date,
    endsAt: Date,
    exceptId?: string,
  ): Promise<boolean> {
    if (!agentId) return false;

    const { date, weekday, time } = enColombia(startsAt);
    const shifts = await this.shifts.find({ where: { agentId } });
    const own = shifts.length ? shifts : DEFAULT_SHIFTS(agentId);
    const cubierto = own.some(
      (shift) =>
        shift.weekday === weekday &&
        shift.startTime <= time &&
        shift.endTime > time &&
        (!shift.validFrom || shift.validFrom <= date) &&
        (!shift.validUntil || shift.validUntil >= date),
    );
    if (!cubierto) return false;

    const query = this.appointments
      .createQueryBuilder('appointment')
      .where('appointment.agent_id = :agentId', { agentId })
      .andWhere('appointment.status IN (:...statuses)', { statuses: BLOCKING })
      .andWhere(
        'appointment.starts_at < :endsAt AND appointment.ends_at > :startsAt',
        { startsAt, endsAt },
      );
    if (exceptId) query.andWhere('appointment.id <> :exceptId', { exceptId });

    return (await query.getCount()) === 0;
  }

  async pickAgentFor(
    startsAt: Date,
    endsAt: Date,
    preferredId?: string | null,
  ): Promise<string | null> {
    const { date, weekday, time } = enColombia(startsAt);

    const team = await this.agents.find({
      where: { status: AgentStatus.ACTIVE },
      select: { id: true, role: true },
    });
    const agentIds = team
      .filter((a) => a.role !== Role.VIEWER)
      .map((a) => a.id);
    if (!agentIds.length) return null;

    const shifts = await this.shifts.find({
      where: agentIds.map((agentId) => ({ agentId })),
    });
    const hasAnyShift = new Set(shifts.map((shift) => shift.agentId));

    const covering = agentIds.filter((agentId) => {
      // Quien no tiene cuadro definido se rige por la jornada estándar.
      const own = hasAnyShift.has(agentId)
        ? shifts.filter((shift) => shift.agentId === agentId)
        : DEFAULT_SHIFTS(agentId);
      return own.some(
        (shift) =>
          shift.weekday === weekday &&
          shift.startTime <= time &&
          shift.endTime > time &&
          (!shift.validFrom || shift.validFrom <= date) &&
          (!shift.validUntil || shift.validUntil >= date),
      );
    });
    if (!covering.length) return null;

    const clashes = await this.appointments
      .createQueryBuilder('appointment')
      .select(['appointment.agentId'])
      .where('appointment.agent_id IN (:...covering)', { covering })
      .andWhere('appointment.status IN (:...statuses)', { statuses: BLOCKING })
      .andWhere(
        'appointment.starts_at < :endsAt AND appointment.ends_at > :startsAt',
        {
          startsAt,
          endsAt,
        },
      )
      .getMany();

    const busy = new Set(clashes.map((appointment) => appointment.agentId));
    const free = covering.filter((agentId) => !busy.has(agentId));
    if (!free.length) return null;

    if (preferredId && free.includes(preferredId)) return preferredId;

    const dayLoad = await this.appointments
      .createQueryBuilder('appointment')
      .select('appointment.agent_id', 'agentId')
      .addSelect('COUNT(*)::int', 'total')
      .where('appointment.agent_id IN (:...free)', { free })
      .andWhere('appointment.status IN (:...statuses)', { statuses: BLOCKING })
      .andWhere("DATE(appointment.starts_at AT TIME ZONE 'UTC') = :date", {
        date,
      })
      .groupBy('appointment.agent_id')
      .getRawMany<{ agentId: string; total: number }>();

    const load = new Map(dayLoad.map((row) => [row.agentId, row.total]));
    return [...free].sort((a, b) => (load.get(a) ?? 0) - (load.get(b) ?? 0))[0];
  }
}

/** Lunes a viernes 8–18 y sábado 9–13, la jornada habitual de la oficina. */
function DEFAULT_SHIFTS(agentId: string): AgentShift[] {
  const make = (weekday: number, startTime: string, endTime: string) =>
    ({
      agentId,
      weekday,
      startTime,
      endTime,
      validFrom: null,
      validUntil: null,
    }) as AgentShift;
  return [
    make(1, '08:00:00', '18:00:00'),
    make(2, '08:00:00', '18:00:00'),
    make(3, '08:00:00', '18:00:00'),
    make(4, '08:00:00', '18:00:00'),
    make(5, '08:00:00', '18:00:00'),
    make(6, '09:00:00', '13:00:00'),
  ];
}

function gridOf(date: string, startTime: string, endTime: string) {
  const slots: { start: Date; end: Date }[] = [];
  let cursor = new Date(`${date}T${startTime.slice(0, 8)}${COLOMBIA}`);
  const limit = new Date(`${date}T${endTime.slice(0, 8)}${COLOMBIA}`);

  while (cursor.getTime() + SLOT_MINUTES * 60_000 <= limit.getTime()) {
    const end = new Date(cursor.getTime() + SLOT_MINUTES * 60_000);
    slots.push({ start: new Date(cursor), end });
    cursor = end;
  }
  return slots;
}

/**
 * Colombia no tiene horario de verano: son siempre −05:00.
 *
 * El turno de un asesor se guarda como hora de pared —"de 08:00 a 15:00"— y
 * eso es hora de Bucaramanga, no UTC. Sellarlo con `Z` lo corria cinco horas:
 * la web ofrecia visitas "de 3 a 10 de la mañana", y como la comprobacion usaba
 * la misma ventana torcida, se podian reservar de madrugada de verdad.
 */
const COLOMBIA = '-05:00';

/**
 * Un instante, leido como hora de pared de Colombia.
 *
 * Los turnos se guardan como "de 08:00 a 15:00" y eso es hora de Bucaramanga.
 * Comparar contra `toISOString()` —que es UTC— desplaza cinco horas: la jornada
 * quedaba de 3 a 10 de la mañana, y las 3 de la tarde caian fuera del turno que
 * las incluye.
 */
function enColombia(instant: Date): {
  date: string;
  weekday: number;
  time: string;
} {
  const local = new Date(instant.getTime() - 5 * 3600 * 1000);
  const iso = local.toISOString();
  return {
    date: iso.slice(0, 10),
    weekday: local.getUTCDay(),
    time: iso.slice(11, 19),
  };
}

function startOfDay(date: string): Date {
  return new Date(`${date.slice(0, 10)}T00:00:00.000${COLOMBIA}`);
}

function endOfDay(date: string): Date {
  return new Date(`${date.slice(0, 10)}T23:59:59.999${COLOMBIA}`);
}
