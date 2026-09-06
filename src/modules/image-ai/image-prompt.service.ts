import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ImagePrompt } from './domain/image-prompt.entity';

/** Techo del prompt. Ver el comentario de `create`. */
const MAX_LARGO = 20_000;

/**
 * El prompt del analisis, editable desde el panel y con marcha atras.
 *
 * Dos capas como en las traducciones: el fichero del repositorio es el punto de
 * partida —lo escribe quien programa y viaja con el codigo— y la tabla es lo
 * que la agencia decidio en su lugar. La diferencia es que aqui no se
 * sobrescribe: cada guardado deja una VERSION nueva y las anteriores se quedan.
 *
 * Eso es lo que hace posible afinar un prompt. Afinar es probar algo, ver que
 * los resultados empeoran y volver: sin historial, "volver" significa acordarse
 * de lo que decia antes.
 */
@Injectable()
export class ImagePromptService {
  private readonly logger = new Logger(ImagePromptService.name);

  constructor(
    @InjectRepository(ImagePrompt)
    private readonly repo: Repository<ImagePrompt>,
    private readonly dataSource: DataSource,
  ) {}

  /**
   * La version que se usa ahora mismo.
   *
   * Si no hay ninguna, siembra la 1 con el fichero del repositorio. Se hace
   * aqui y no en la migracion porque el texto por defecto cambia con el codigo:
   * clavarlo en una migracion lo dejaria congelado en lo que decia el dia del
   * despliegue.
   */
  async active(): Promise<ImagePrompt> {
    const activa = await this.repo.findOne({ where: { active: true } });
    if (activa) return activa;

    const existentes = await this.repo.count();
    if (existentes) {
      // Hay versiones pero ninguna activa: alguien dejo la tabla a medias. Se
      // activa la ultima en vez de sembrar una nueva.
      const ultima = await this.repo.findOne({
        where: {},
        order: { version: 'DESC' },
      });
      await this.activate(ultima!.version);
      return (await this.repo.findOne({ where: { active: true } }))!;
    }

    return this.repo.save(
      this.repo.create({
        version: 1,
        body: this.leerFichero(),
        notes: 'Version inicial del repositorio',
        active: true,
        createdByAgentId: null,
      }),
    );
  }

  /** El historial, de lo mas nuevo a lo mas viejo. */
  list(): Promise<ImagePrompt[]> {
    return this.repo.find({ order: { version: 'DESC' } });
  }

  findVersion(version: number): Promise<ImagePrompt | null> {
    return this.repo.findOne({ where: { version } });
  }

  /**
   * Guardar una version nueva y dejarla activa.
   *
   * El tope de 20.000 caracteres no es capricho: un prompt que crece sin freno
   * llega a un punto en el que el modelo deja de leerlo entero y empieza a
   * olvidarse de lo del medio. Con un limite, quien lo edita ve el aviso y
   * decide que sobra; sin el, se degrada en silencio y parece que el modelo ha
   * empeorado.
   */
  async create(
    body: string,
    notes: string | null,
    agentId: string,
  ): Promise<ImagePrompt> {
    const texto = body.trim();
    if (texto.length < 50) {
      throw new BadRequestException(
        'El prompt se ha quedado en nada. Si lo que quieres es volver al de fabrica, usa "restaurar el original".',
      );
    }
    if (texto.length > MAX_LARGO) {
      throw new BadRequestException(
        `El prompt tiene ${texto.length} caracteres y el limite son ${MAX_LARGO}. Por encima de eso el modelo deja de leerlo entero y empieza a saltarse instrucciones del medio.`,
      );
    }
    if (!texto.toLowerCase().includes('json')) {
      // No se bloquea —el usuario manda—, pero un prompt que no pide JSON hace
      // que fallen todos los analisis, y eso hay que verlo antes de gastar.
      this.logger.warn(
        'El prompt nuevo no menciona JSON en ningun sitio: es probable que el modelo devuelva prosa y no se pueda guardar nada.',
      );
    }

    // En una transaccion: entre apagar la activa y encender la nueva no puede
    // haber un instante sin ninguna, o un analisis que caiga justo ahi
    // sembraria una version 1 encima.
    return this.dataSource.transaction(async (manager) => {
      const repo = manager.getRepository(ImagePrompt);
      const ultima = await repo.findOne({
        where: {},
        order: { version: 'DESC' },
      });
      await repo.update({ active: true }, { active: false });
      return repo.save(
        repo.create({
          version: (ultima?.version ?? 0) + 1,
          body: texto,
          notes: notes?.trim().slice(0, 500) || null,
          active: true,
          createdByAgentId: agentId,
        }),
      );
    });
  }

  /**
   * Volver a una version anterior.
   *
   * Se activa la que ya existe en lugar de copiarla en una version nueva: asi
   * los analisis que se hicieron con ella siguen apuntando al mismo numero y
   * "los resultados de la v3" sigue queriendo decir lo mismo antes y despues de
   * la vuelta atras.
   */
  async activate(version: number): Promise<ImagePrompt> {
    return this.dataSource.transaction(async (manager) => {
      const repo = manager.getRepository(ImagePrompt);
      const destino = await repo.findOne({ where: { version } });
      if (!destino) {
        throw new BadRequestException(
          `No existe la version ${version} del prompt`,
        );
      }
      await repo.update({ active: true }, { active: false });
      await repo.update({ version }, { active: true });
      return { ...destino, active: true };
    });
  }

  /** El texto de fabrica, para poder enseñarlo al lado del editado. */
  defaultBody(): string {
    return this.leerFichero();
  }

  /**
   * El fichero del repositorio.
   *
   * Se lee en cada llamada y no al arrancar porque se pide una vez cada mucho —
   * al sembrar la version 1 y cuando alguien abre el editor— y asi un cambio en
   * el fichero no necesita reiniciar el proceso para verse.
   */
  private leerFichero(): string {
    try {
      return readFileSync(
        join(__dirname, 'defaults', 'analisis-imagenes.md'),
        'utf8',
      );
    } catch (error) {
      this.logger.error(
        `No pude leer el prompt por defecto: ${(error as Error).message}`,
      );
      // Un minimo viable antes que quedarse sin prompt: sin esto, un fichero
      // que no se copio al empaquetar deja el modulo inservible y el error
      // aparece a mitad de un analisis ya pagado.
      return 'Analiza cada imagen de un inmueble y responde en JSON con la forma {"images":[{"index":0,"room":"OTHER","quality":50,"coverScore":0,"caption":"","issues":[],"fixes":[],"privacy":{"faces":false,"plates":false,"documents":false,"screens":false,"notes":null},"usable":true}]}.';
    }
  }
}
