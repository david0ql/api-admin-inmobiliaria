import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { Property } from '../properties/domain/property.entity';
import {
  PublicationStatus,
  Availability,
} from '../properties/domain/property.enums';
import { HomeSettings, ShowcaseSource } from './domain/home-settings.entity';
import { CacheBuster } from '../../shared/cache/cache-buster.service';
import type { UpdateHomeSettingsDto } from './dto/home-settings.dto';

const VISIBLE = [PublicationStatus.ACTIVE, PublicationStatus.OUTSTANDING];

/**
 * El escaparate de la portada.
 *
 * Se guarda en memoria un minuto: lo lee cada visita a la home y cambia una vez
 * a la semana como mucho.
 */
@Injectable()
export class HomeSettingsService {
  private cached?: { value: HomeSettings; hasta: number };

  constructor(
    @InjectRepository(HomeSettings)
    private readonly repo: Repository<HomeSettings>,
    @InjectRepository(Property)
    private readonly properties: Repository<Property>,
    private readonly buster: CacheBuster,
  ) {}

  async get(): Promise<HomeSettings> {
    const ahora = Date.now();
    if (this.cached && this.cached.hasta > ahora) return this.cached.value;

    const value =
      (await this.repo.findOne({ where: {} })) ??
      (await this.repo.save(this.repo.create({})));
    this.cached = { value, hasta: ahora + 60_000 };
    return value;
  }

  async update(dto: UpdateHomeSettingsDto): Promise<HomeSettings> {
    const actual = await this.get();
    await this.repo.update({ id: actual.id }, dto);
    this.cached = undefined;
    // Sin esto, la agencia guarda y no ve nada durante cinco minutos: peor que
    // lento es que parezca roto.
    await this.buster.flush('ajustes de la portada');
    return this.get();
  }

  /**
   * Los inmuebles del carrusel, ya resueltos.
   *
   * Se resuelve aqui y no en la web para que el sitio no tenga que saber que
   * significa cada modo: pide el escaparate y pinta lo que le llega.
   */
  async showcase(): Promise<{
    enabled: boolean;
    properties: Property[];
    autoplay: boolean;
    delayMs: number;
    effect: string;
  }> {
    const settings = await this.get();

    // Apagado no se consulta el inventario: la web no va a pintar nada, y una
    // consulta con relaciones por cada visita a la portada no es gratis.
    if (!settings.enabled) {
      return {
        enabled: false,
        properties: [],
        autoplay: settings.autoplay,
        delayMs: settings.delayMs,
        effect: settings.effect,
      };
    }

    const take = Math.min(24, Math.max(3, settings.count));

    return {
      enabled: true,
      properties: await this.elegidos(settings, take),
      autoplay: settings.autoplay,
      delayMs: settings.delayMs,
      effect: settings.effect,
    };
  }

  /**
   * Que inmuebles salen.
   *
   * Sin barajar, a proposito: el rotulo dice "ultimos inmuebles" y eso es una
   * promesa concreta —lo que la agencia acaba de publicar—, no una seleccion
   * variada. Quien vuelve al dia siguiente quiere ver si hay algo nuevo, y para
   * eso el orden tiene que ser el mismo. Los proyectos si rotan, porque ahi el
   * rotulo no promete novedad.
   */
  private elegidos(settings: HomeSettings, take: number): Promise<Property[]> {
    const relations = {
      images: true,
      city: true,
      zone: true,
      propertyType: true,
      currency: true,
    };

    if (settings.source === ShowcaseSource.MANUAL && settings.codes?.length) {
      return this.properties
        .find({
          where: {
            code: In(settings.codes.slice(0, take)),
            publicationStatus: In(VISIBLE),
          },
          relations,
        })
        .then((elegidos) => {
          // En el orden que puso la agencia, no en el que devuelve la base: si
          // eligio a mano, el orden es parte de la eleccion.
          const porCodigo = new Map(elegidos.map((p) => [p.code, p]));
          return settings.codes
            .map((code) => porCodigo.get(code))
            .filter((p): p is Property => Boolean(p));
        });
    }

    return this.properties.find({
      where:
        settings.source === ShowcaseSource.OUTSTANDING
          ? {
              publicationStatus: PublicationStatus.OUTSTANDING,
              availability: Availability.AVAILABLE,
            }
          : VISIBLE.map((publicationStatus) => ({
              publicationStatus,
              availability: Availability.AVAILABLE,
            })),
      relations,
      order: { createdAt: 'DESC' },
      take,
    });
  }
}
