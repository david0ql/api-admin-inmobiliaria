import { ApiProperty } from '@nestjs/swagger';
import { Column, Entity } from 'typeorm';
import { BaseEntity } from '../../../shared/database/base.entity';
import { Availability } from '../../properties/domain/property.enums';

/** Un tramo de atención: `08:00`–`12:00`. */
export interface TimeRange {
  from: string;
  to: string;
}

/**
 * Un día de la semana en el horario de la oficina.
 *
 * `ranges` y no un `from`/`to` sueltos porque la jornada tiene pausa de
 * mediodía: de 8 a 12 y de 2 a 6. Con un solo tramo, o se dejaba abierto el
 * almuerzo —y la web ofrecía visitas a la una— o se perdía media tarde.
 */
export interface WorkdayHours {
  /** 0 domingo … 6 sábado, como `Date.getDay()`. */
  weekday: number;
  /** Se ignoran si `open` es falso. */
  ranges: TimeRange[];
  /** Si se atiende ese día. */
  open: boolean;
}

/**
 * Cómo se decide la antelación mínima.
 *
 * Son las dos formas que planteó la agencia y no se pueden mezclar: o todos los
 * inmuebles piden lo mismo, o cada uno pide según su estado. Tenerlo como un
 * modo explícito evita la duda de "si relleno los dos, ¿cuál manda?".
 */
export enum LeadMode {
  /** Lo mismo para todo el inventario. Sencillo de explicar por teléfono. */
  UNIFORM = 'UNIFORM',
  /** Según disponibilidad y operación del inmueble. */
  BY_AVAILABILITY = 'BY_AVAILABILITY',
}

/** Días mínimos de antelación según en qué estado esté el inmueble. */
export type LeadByAvailability = Partial<Record<Availability, number>>;

/** Y según la operación. */
export interface LeadByOperation {
  sale: number;
  rent: number;
}

/** El horario real de la agencia: L-V 8-12 y 14-18, sábado 8-12. */
const MANANA_Y_TARDE: TimeRange[] = [
  { from: '08:00', to: '12:00' },
  { from: '14:00', to: '18:00' },
];
const SOLO_MANANA: TimeRange[] = [{ from: '08:00', to: '12:00' }];

export const DEFAULT_WORKDAYS: WorkdayHours[] = [
  { weekday: 0, ranges: SOLO_MANANA, open: false },
  { weekday: 1, ranges: MANANA_Y_TARDE, open: true },
  { weekday: 2, ranges: MANANA_Y_TARDE, open: true },
  { weekday: 3, ranges: MANANA_Y_TARDE, open: true },
  { weekday: 4, ranges: MANANA_Y_TARDE, open: true },
  { weekday: 5, ranges: MANANA_Y_TARDE, open: true },
  { weekday: 6, ranges: SOLO_MANANA, open: true },
];

export const DEFAULT_LEAD_BY_AVAILABILITY: LeadByAvailability = {
  [Availability.AVAILABLE]: 1,
  [Availability.RESERVED]: 2,
  [Availability.WITHDRAWN]: 5,
  [Availability.SOLD]: 5,
  [Availability.RENTED]: 5,
};

export const DEFAULT_LEAD_BY_OPERATION: LeadByOperation = { sale: 1, rent: 2 };

/**
 * Los parámetros de la agenda, en la base y no en el código.
 *
 * Antes la jornada estaba escrita en `availability.service.ts` —lunes a viernes
 * de 8 a 18, sábado de 9 a 13— y la antelación mínima era una sola variable de
 * entorno igual para todo. Cambiar cualquiera de las dos cosas pedía un
 * despliegue, así que en la práctica no se cambiaban.
 *
 * Es una fila única: no hay multi-agencia ni la va a haber, y un `key/value`
 * genérico obligaría a validar tipos a mano en cada lectura.
 */
@Entity('booking_settings')
export class BookingSettings extends BaseEntity {
  @ApiProperty({
    description: 'Horario de atención, un elemento por día de la semana.',
  })
  @Column({ type: 'jsonb', default: () => "'[]'" })
  workdays: WorkdayHours[];

  /**
   * Cuántos días antes, como mínimo, se puede pedir una visita según el estado
   * del inmueble.
   *
   * Un inmueble reservado o retirado necesita más margen porque hay que
   * confirmar con el propietario antes de enseñarlo; uno disponible se puede
   * ver mañana mismo.
   */
  @ApiProperty({ enum: LeadMode })
  @Column({ type: 'enum', enum: LeadMode, default: LeadMode.UNIFORM })
  leadMode: LeadMode;

  /** Cuando el modo es `UNIFORM`: lo mismo para todo el inventario. */
  @ApiProperty({ description: 'Antelación mínima única, en horas.' })
  @Column({ type: 'int', default: 24 })
  uniformLeadHours: number;

  @ApiProperty({
    description: 'Días mínimos de antelación por disponibilidad.',
  })
  @Column({ type: 'jsonb', default: () => "'{}'" })
  leadDaysByAvailability: LeadByAvailability;

  @ApiProperty({ description: 'Días mínimos de antelación por operación.' })
  @Column({ type: 'jsonb', default: () => "'{}'" })
  leadDaysByOperation: LeadByOperation;

  /**
   * Cuántas franjas próximas propone el asistente.
   *
   * Los inmuebles los publican varias agencias a la vez: gana quien enseña
   * antes. Por eso el asistente ofrece las horas más cercanas concretas —"¿te
   * viene mañana a las 2 o a las 3?"— en lugar de listar el calendario entero
   * y dejar que el visitante decida cuándo le apetece.
   */
  @ApiProperty({ description: 'Cuántas horas próximas propone el asistente.' })
  @Column({ type: 'int', default: 2 })
  suggestedSlots: number;

  /**
   * Cuántos inmuebles enseña el chat de una búsqueda.
   *
   * Ocho es un catálogo y se lee como un catálogo: el visitante los repasa, se
   * lo piensa y se va. Tres se leen y se eligen — es el número que pidió la
   * agencia después de ver que ocho no llevaban a ninguna cita.
   */
  @ApiProperty({ description: 'Cuántos inmuebles muestra el chat al buscar.' })
  @Column({ type: 'int', default: 3 })
  suggestedProperties: number;

  /** Duración de cada visita, en minutos. */
  @ApiProperty()
  @Column({ type: 'int', default: 60 })
  slotMinutes: number;
}
