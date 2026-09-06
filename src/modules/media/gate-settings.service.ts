import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ImageGateSettings } from './image-gate-settings.entity';
import {
  DEFAULT_RULES,
  GateProfile,
  gateRulesSchema,
  type GateRules,
} from './image-gate.rules';

/** Cuanto se guardan los umbrales en memoria: se leen en cada subida. */
const CACHE_MS = 60_000;

/**
 * Los umbrales efectivos de cada perfil.
 *
 * Dos capas, igual que las traducciones: lo del repositorio y encima lo que la
 * agencia cambio. Se resuelve en memoria porque esto se consulta una vez por
 * foto subida —treinta veces seguidas cuando un asesor carga una galeria— y son
 * catorce numeros.
 *
 * Lo importante es que se guarda solo lo TOCADO. Si manana se sube el minimo de
 * ancho de 1024 a 1200 desde el panel, el resto de umbrales siguen siendo los
 * del repositorio y se moveran solos el dia que alguien los mejore ahi. Si se
 * guardara la tabla entera, la primera edicion congelaria los otros trece
 * valores para siempre sin que nadie lo notara.
 */
@Injectable()
export class GateSettingsService {
  private readonly logger = new Logger(GateSettingsService.name);
  private cache = new Map<GateProfile, { value: GateRules; hasta: number }>();

  constructor(
    @InjectRepository(ImageGateSettings)
    private readonly repo: Repository<ImageGateSettings>,
  ) {}

  /** Los umbrales que hay que aplicar ahora mismo a este perfil. */
  async rules(profile: GateProfile): Promise<GateRules> {
    const ahora = Date.now();
    const guardado = this.cache.get(profile);
    if (guardado && guardado.hasta > ahora) return guardado.value;

    const fila = await this.repo.findOne({ where: { profile } });
    const value = this.mezclar(profile, fila?.overrides ?? {});
    this.cache.set(profile, { value, hasta: ahora + CACHE_MS });
    return value;
  }

  /** Lo que pinta el panel: el valor de fabrica, el efectivo y si se toco. */
  async describe(): Promise<
    {
      profile: GateProfile;
      defaults: GateRules;
      effective: GateRules;
      overridden: string[];
      updatedAt: Date | null;
    }[]
  > {
    const filas = await this.repo.find();
    const porPerfil = new Map(filas.map((f) => [f.profile, f]));

    return Object.values(GateProfile).map((profile) => {
      const fila = porPerfil.get(profile);
      const overrides = fila?.overrides ?? {};
      return {
        profile,
        defaults: DEFAULT_RULES[profile],
        effective: this.mezclar(profile, overrides),
        overridden: Object.keys(overrides),
        updatedAt: fila?.updatedAt ?? null,
      };
    });
  }

  /**
   * Cambiar umbrales.
   *
   * Un valor `null` borra la sobrescritura y devuelve el de fabrica: es la
   * unica forma de deshacer sin tener que acordarse de cual era el numero
   * bueno. Se valida el resultado COMPLETO, no solo lo que llega, porque un
   * minimo de ancho de 3000 es valido por si mismo y sin embargo deja fuera el
   * 99 % del inventario.
   */
  async update(
    profile: GateProfile,
    cambios: Record<string, number | boolean | null>,
    agentId: string,
  ): Promise<GateRules> {
    const fila =
      (await this.repo.findOne({ where: { profile } })) ??
      this.repo.create({ profile, overrides: {}, updatedByAgentId: null });

    const overrides = { ...(fila.overrides ?? {}) };
    for (const [clave, valor] of Object.entries(cambios)) {
      if (!(clave in DEFAULT_RULES[profile])) {
        throw new BadRequestException(
          `"${clave}" no es un umbral de la puerta de imagenes. Los que hay: ${Object.keys(DEFAULT_RULES[profile]).join(', ')}.`,
        );
      }
      if (valor === null) delete overrides[clave];
      else overrides[clave] = valor;
    }

    const efectivos = this.validar(profile, overrides);
    this.avisarSiEsRaro(profile, efectivos);

    fila.overrides = overrides;
    fila.updatedByAgentId = agentId;
    await this.repo.save(fila);
    this.cache.delete(profile);

    return efectivos;
  }

  /** Vuelve un perfil entero a los valores del repositorio. */
  async reset(profile: GateProfile): Promise<GateRules> {
    await this.repo.delete({ profile });
    this.cache.delete(profile);
    return DEFAULT_RULES[profile];
  }

  private mezclar(
    profile: GateProfile,
    overrides: Record<string, unknown>,
  ): GateRules {
    try {
      return this.validar(profile, overrides);
    } catch (error) {
      // Con la fila mal, se sigue con los de fabrica: quedarse sin poder subir
      // fotos porque alguien guardo un numero raro seria peor que ignorarlo.
      this.logger.error(
        `Umbrales invalidos en "${profile}", uso los del repositorio: ${(error as Error).message}`,
      );
      return DEFAULT_RULES[profile];
    }
  }

  private validar(
    profile: GateProfile,
    overrides: Record<string, unknown>,
  ): GateRules {
    const mezcla = { ...DEFAULT_RULES[profile], ...overrides };
    const parsed = gateRulesSchema.safeParse(mezcla);
    if (!parsed.success) {
      throw new BadRequestException(
        parsed.error.issues
          .map((i) => `${i.path.join('.')}: ${i.message}`)
          .join('; '),
      );
    }
    const r = parsed.data;
    if (r.minAspectRatio > r.maxAspectRatio) {
      throw new BadRequestException(
        'La proporcion minima no puede ser mayor que la maxima',
      );
    }
    if (r.recommendedWidth < r.minWidth) {
      throw new BadRequestException(
        'El ancho recomendado no puede ser menor que el minimo: el aviso nunca saltaria',
      );
    }
    if (r.minBrightness > r.maxBrightness) {
      throw new BadRequestException(
        'El brillo minimo no puede ser mayor que el maximo',
      );
    }
    return r;
  }

  /**
   * No impide guardar, pero lo deja escrito.
   *
   * Un umbral demasiado alto no rompe nada visible: simplemente empiezan a
   * rechazarse fotos y nadie relaciona una cosa con la otra hasta semanas
   * despues. Que quede en el log es lo minimo.
   */
  private avisarSiEsRaro(profile: GateProfile, r: GateRules): void {
    if (r.minWidth > 2000) {
      this.logger.warn(
        `${profile}: minWidth en ${r.minWidth} px deja fuera casi todo el inventario actual (el 87 % de las fotos de produccion baja de 2000 px de ancho)`,
      );
    }
    if (profile === GateProfile.REQUEST && r.aspectBlocks) {
      this.logger.warn(
        'REQUEST: bloquear por proporcion hace que un propietario con el movil en vertical no pueda mandar su solicitud. Eso cuesta clientes.',
      );
    }
  }
}
