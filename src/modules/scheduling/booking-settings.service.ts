import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Availability } from '../properties/domain/property.enums';
import {
  BookingSettings,
  LeadMode,
  DEFAULT_LEAD_BY_AVAILABILITY,
  DEFAULT_LEAD_BY_OPERATION,
  DEFAULT_WORKDAYS,
  type WorkdayHours,
} from './domain/booking-settings.entity';
import type { UpdateBookingSettingsDto } from './dto/booking-settings.dto';

/**
 * Los parámetros de la agenda.
 *
 * Se leen en cada cálculo de disponibilidad, así que se guardan en memoria
 * durante un minuto: un cambio desde el panel entra casi al momento y no se
 * consulta la base una vez por franja.
 */
@Injectable()
export class BookingSettingsService {
  private cached?: { value: BookingSettings; hasta: number };

  constructor(
    @InjectRepository(BookingSettings)
    private readonly repo: Repository<BookingSettings>,
  ) {}

  async get(): Promise<BookingSettings> {
    const ahora = Date.now();
    if (this.cached && this.cached.hasta > ahora) return this.cached.value;

    const value = (await this.repo.findOne({ where: {} })) ?? this.crearFila();
    this.cached = { value: await value, hasta: ahora + 60_000 };
    return this.cached.value;
  }

  async update(dto: UpdateBookingSettingsDto): Promise<BookingSettings> {
    const actual = await this.get();
    await this.repo.update({ id: actual.id }, dto);
    this.cached = undefined;
    return this.get();
  }

  /**
   * La primera vez no hay fila: se crea con los valores que hasta ahora
   * estaban escritos en el código, para que nada cambie de comportamiento el
   * día que se despliega esto.
   */
  private async crearFila(): Promise<BookingSettings> {
    return this.repo.save(
      this.repo.create({
        workdays: DEFAULT_WORKDAYS,
        leadMode: LeadMode.UNIFORM,
        uniformLeadHours: 24,
        leadDaysByAvailability: DEFAULT_LEAD_BY_AVAILABILITY,
        leadDaysByOperation: DEFAULT_LEAD_BY_OPERATION,
        suggestedSlots: 2,
        suggestedProperties: 3,
        slotMinutes: 60,
      }),
    );
  }

  /**
   * La antelación mínima de un inmueble concreto, en horas.
   *
   * En modo `UNIFORM` es la misma para todo. En `BY_AVAILABILITY` manda el más
   * exigente de los dos criterios: un inmueble reservado que además está en
   * arriendo espera lo que pida el más largo. Quedarse con el menor dejaría que
   * un parámetro anulase al otro sin que nadie lo hubiera decidido.
   */
  async leadHoursFor(property: {
    availability: Availability;
    forSale?: boolean;
    forRent?: boolean;
  }): Promise<number> {
    const settings = await this.get();
    if (settings.leadMode === LeadMode.UNIFORM) {
      return settings.uniformLeadHours;
    }

    const porEstado =
      settings.leadDaysByAvailability?.[property.availability] ??
      DEFAULT_LEAD_BY_AVAILABILITY[property.availability] ??
      1;

    const porOperacion = property.forRent
      ? (settings.leadDaysByOperation?.rent ?? DEFAULT_LEAD_BY_OPERATION.rent)
      : (settings.leadDaysByOperation?.sale ?? DEFAULT_LEAD_BY_OPERATION.sale);

    return Math.max(porEstado, porOperacion) * 24;
  }

  /** La antelación cuando no hay un inmueble de por medio. */
  async defaultLeadHours(): Promise<number> {
    const settings = await this.get();
    return settings.leadMode === LeadMode.UNIFORM
      ? settings.uniformLeadHours
      : (settings.leadDaysByOperation?.sale ?? DEFAULT_LEAD_BY_OPERATION.sale) *
          24;
  }

  /** El horario de un día concreto, o `null` si ese día no se atiende. */
  async hoursFor(weekday: number): Promise<WorkdayHours | null> {
    const settings = await this.get();
    const dias = settings.workdays?.length
      ? settings.workdays
      : DEFAULT_WORKDAYS;
    const dia = dias.find((d) => d.weekday === weekday);
    return dia?.open ? dia : null;
  }
}
