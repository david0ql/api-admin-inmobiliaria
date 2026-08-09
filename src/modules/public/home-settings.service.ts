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
    // Y la rotacion guardada, que se armo con los ajustes de antes.
    this.rotacion = undefined;
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
  /**
   * El escaparate resuelto: el grupo en memoria y los ordenes ya hechos.
   *
   * La clave es que la base NO se consulta por visita. Se lee un grupo amplio
   * cada diez minutos, se dejan preparados sesenta recortes distintos y cada
   * peticion sirve el siguiente. Seis consultas por hora, pase lo que pase con
   * el trafico, y aun asi quien recarga la portada ve otros inmuebles.
   */
  private rotacion?: { hasta: number; variantes: Property[][] };
  private turno = 0;

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
   * Que inmuebles salen esta vez.
   *
   * A mano no se rota: si la agencia eligio los codigos y su orden, ese orden
   * es parte de la eleccion y barajarlo seria desobedecer al panel. En los
   * otros dos modos si, porque "los ultimos" y "los destacados" son grupos, no
   * una lista cerrada, y enseñar siempre los mismos nueve deja al resto del
   * inventario sin existir para quien vuelve.
   */
  private async elegidos(
    settings: HomeSettings,
    take: number,
  ): Promise<Property[]> {
    const ahora = Date.now();

    if (this.rotacion && this.rotacion.hasta > ahora) {
      const { variantes } = this.rotacion;
      this.turno = (this.turno + 1) % variantes.length;
      return variantes[this.turno];
    }

    const grupo = await this.grupo(settings, take);
    const variantes =
      settings.source === ShowcaseSource.MANUAL || grupo.length <= take
        ? [grupo.slice(0, take)]
        : Array.from({ length: VARIANTES }, () =>
            barajar(grupo).slice(0, take),
          );

    this.rotacion = { hasta: ahora + POOL_TTL_MS, variantes };
    this.turno = 0;
    return variantes[0];
  }

  /**
   * El grupo del que se elige: mas ancho que lo que se enseña.
   *
   * Se traen el triple —hasta 36— porque barajar una lista de nueve para
   * enseñar nueve solo cambia el orden, no las fichas. Y solo el triple, no el
   * inventario entero, para que "los ultimos publicados" siga significando algo
   * y no salga uno de hace dos años.
   */
  private grupo(settings: HomeSettings, take: number): Promise<Property[]> {
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
      take: Math.min(36, take * 3),
    });
  }
}

const POOL_TTL_MS = 10 * 60 * 1000;
const VARIANTES = 60;

/** Fisher-Yates: cada orden posible sale con la misma probabilidad. */
function barajar<T>(items: T[]): T[] {
  const copia = [...items];
  for (let i = copia.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copia[i], copia[j]] = [copia[j], copia[i]];
  }
  return copia;
}
