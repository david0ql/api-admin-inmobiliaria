import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, resolve, sep } from 'node:path';
import sharp from 'sharp';
import { AppConfigService } from '../../shared/config/app-config.service';
import { FileSecurityService, sanitizeName } from './file-security.service';
import { ImageDevelopService, type Revelado } from './image-develop.service';
import type { ImageMetrics } from './image-gate.rules';

export interface StoredImage {
  /** Ruta relativa dentro de `uploads/`; es lo que se guarda en la base. */
  key: string;
  url: string;
  urlMedium: string;
  urlLarge: string;
  urlOriginal: string;
  width: number;
  height: number;
  bytes: number;
  mimeType: string;
  /** Huella del original: permite no reprocesar una foto ya guardada. */
  checksum: string;
  /** El revelado aplicado, o null si la foto no necesitaba ninguno. */
  revelado: Revelado | null;
  /** La foto SIN revelar, para poder comparar sin escribir nada. */
  urlRaw: string;
  urlRawLarge: string;
}

const ACCEPTED = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/avif',
  'image/gif',
]);

/**
 * Tope de pixeles de entrada. Una foto de 100 megapixeles no existe en este
 * negocio, pero un PNG manipulado que los declare tumba el proceso al
 * decodificarlo.
 */
const MAX_INPUT_PIXELS = 100_000_000;

/** Anchos derivados: listado, tarjeta en movil, ficha y archivo. */
const THUMB_WIDTH = 560;
/**
 * El tamano intermedio existe por los moviles. Una foto a pantalla completa
 * ocupa 412 px logicos, pero a densidad 1,75 el navegador necesita 721 px
 * reales; sin este paso saltaba a la de 1600 px, o sea 405 kB por foto en
 * lugar de 43.
 *
 * 800 y no 1024: 1024 son un 40% de pixeles de mas sobre los 721 que hacen
 * falta, y esta es la foto que el navegador cronometra para decidir si la ficha
 * va rapida. Bajarla a 800 son ~60 kB menos en la unica imagen que el visitante
 * esta esperando ver, y a 1,94 veces la densidad de la pantalla no se aprecia.
 */
const MEDIUM_WIDTH = 800;
const LARGE_WIDTH = 1600;
/**
 * El archivo se topa en 2560 px. Las camaras suben fotos de 4032 px que nadie
 * mira a ese tamano; reencodearlas enteras era el 70 % del coste de CPU de la
 * importacion y multiplicaba por tres el espacio en disco.
 */
const ARCHIVE_WIDTH = 2560;

/**
 * Los cuatro anchos y sus calidades, en cascada. Estan juntos porque el
 * revelado los recorre y tener las cifras repartidas garantizaba que un dia
 * `backfill` generara algo distinto de lo que genera una subida.
 */
const VARIANTES = [
  { sufijo: '-o.webp', ancho: ARCHIVE_WIDTH, calidad: 86 },
  { sufijo: '-l.webp', ancho: LARGE_WIDTH, calidad: 82 },
  { sufijo: '-m.webp', ancho: MEDIUM_WIDTH, calidad: 80 },
  { sufijo: '-t.webp', ancho: THUMB_WIDTH, calidad: 78 },
] as const;

/**
 * El negativo: la foto entera, enderezada por EXIF y reducida a 2560 px, SIN
 * revelar.
 *
 * Es la pieza que hace reversible todo lo demas. Las fotos son de inmuebles de
 * clientes reales y el revelado es automatico: si un dia deja una foto peor,
 * tiene que poder deshacerse sin volver a pedirsela al propietario. Con el
 * negativo en disco, deshacer es regenerar las cuatro variantes desde el, y
 * cuesta lo mismo que generarlas.
 *
 * Ocupa: es una copia mas del tamano de archivo, unos 2,7 GB sobre los 4,5 que
 * ya hay. Es el precio de poder decir que no se ha perdido nada.
 */
const RAW_SUFFIX = '-r.webp';

/**
 * El recorte de una foto, en FRACCIONES de 0 a 1 y nunca en pixeles.
 *
 * En fracciones porque la misma decision tiene que valer para las cuatro
 * variantes: en pixeles habria que recalcularla para 2560, 1600, 800 y 560, y
 * el dia que cambie un ancho quedarian mal las que ya estuvieran guardadas.
 *
 * Se guarda en la fila de la imagen y se aplica al regenerar, igual que el
 * revelado. Por eso recortar es reversible y no acumula: se recorta siempre
 * sobre el negativo entero, no sobre lo ya recortado.
 */
export interface Caja {
  x: number;
  y: number;
  ancho: number;
  alto: number;
}

/**
 * Las dos versiones SIN revelar que se publican, para poder comparar.
 *
 * El negativo esta a 2560 px y pintar eso en una rejilla de 6.306 fotos no es
 * una opcion, asi que el "antes" tiene sus propios tamanos de listado y de
 * ficha. Son los mismos anchos y calidades que sus gemelas reveladas: si el
 * "antes" se sirviera con otra calidad, media diferencia de la comparacion
 * seria el compresor y no el revelado, y entonces la comparacion no dice nada.
 *
 * Se generan una sola vez, cuando nace el negativo, porque el negativo no
 * cambia nunca. Ocupan unos 35 kB por foto — unos 220 MB sobre las 6.306.
 */
const VARIANTES_SIN_REVELAR = [
  { sufijo: '-rl.webp', ancho: LARGE_WIDTH, calidad: 82 },
  { sufijo: '-rt.webp', ancho: THUMB_WIDTH, calidad: 78 },
] as const;

/**
 * libvips paraleliza cada operacion entre todos los nucleos. Con varias fotos
 * en vuelo eso solo produce contencion: el paralelismo lo pone la cola de
 * descargas, asi que cada imagen se procesa en un hilo.
 */
sharp.concurrency(1);
sharp.cache({ files: 0 });

/**
 * Almacenamiento local de imagenes.
 *
 * Todo lo que se sube — o se importa desde WASI — se procesa aqui: se valida
 * que sea una imagen de verdad leyendo sus metadatos (no fiandose del
 * `Content-Type`, que lo pone quien sube), se recomprime a WebP en dos anchos
 * y se guarda bajo `uploads/`. Asi el inventario deja de depender del CDN de un
 * proveedor externo que puede cortar el acceso el dia que se cierre la cuenta.
 */
@Injectable()
export class StorageService {
  private readonly logger = new Logger(StorageService.name);

  /** Lo que se sirve en `/media/`: imagenes, que son el anuncio. */
  readonly root: string;

  /**
   * Lo que NO se sirve: escrituras, cedulas, certificados de tradicion.
   *
   * Carpeta HERMANA de `root` y no una subcarpeta suya. `useStaticAssets`
   * publica el arbol entero de `root`, asi que cualquier cosa colgada de el es
   * descargable por quien acierte la ruta — y un uuid en la URL es ocultar, no
   * proteger: esas direcciones acaban en el historial, en los logs del proxy y
   * en la cabecera `Referer`. Estando fuera, no hay `express.static` que las
   * alcance aunque alguien se equivoque en el orden de los middlewares.
   */
  readonly privateRoot: string;

  constructor(
    private readonly config: AppConfigService,
    private readonly security: FileSecurityService,
    private readonly develop: ImageDevelopService,
  ) {
    const dir = config.uploadsDir;
    this.root = isAbsolute(dir) ? dir : resolve(process.cwd(), dir);
    this.privateRoot = resolve(
      this.root,
      '..',
      `${basename(this.root)}-private`,
    );
  }

  /** Ruta publica desde la que Express sirve `uploads/`. */
  private publicUrl(key: string): string {
    return `/media/${key}`;
  }

  /**
   * Guarda una imagen y sus derivados.
   *
   * `scope` agrupa por entidad (`properties/<id>`), de modo que borrar un
   * inmueble es borrar una carpeta.
   */
  async saveImage(
    buffer: Buffer,
    scope: string,
    originalName?: string,
    /**
     * `metrics` es lo que ya midio la puerta de calidad, para no volver a
     * decodificar la foto entera; `revelar` en false guarda la foto tal cual
     * llego, que es lo que hace falta al reimportar algo ya revelado.
     */
    {
      metrics,
      revelar = true,
    }: { metrics?: ImageMetrics; revelar?: boolean } = {},
  ): Promise<StoredImage> {
    const safeName = sanitizeName(originalName ?? 'imagen');

    // Primero se comprueba que es una imagen de verdad y que no lleva nada
    // dentro; solo despues se decodifica. Al reencodearla entera desaparece
    // cualquier carga util que hubiera sobrevivido: lo que se guarda son
    // pixeles nuevos, no los bytes que subio el usuario.
    await this.security.inspect(buffer, safeName, ['image']);

    let meta: sharp.Metadata;
    try {
      meta = await sharp(buffer, {
        // Corta las bombas de descompresion: un PNG de 2 KB puede declarar
        // 50.000 x 50.000 px y agotar la memoria del proceso al decodificarlo.
        limitInputPixels: MAX_INPUT_PIXELS,
        // Un solo fotograma: los GIF animados no son fotos de inmueble.
        pages: 1,
      }).metadata();
    } catch {
      throw new BadRequestException(
        `"${safeName}" no es una imagen que se pueda procesar`,
      );
    }

    // sharp reporta el JPEG como `jpeg`, pero se normaliza por si acaso.
    const format = String(meta.format ?? '');
    const mimeType = format
      ? `image/${format === 'jpg' ? 'jpeg' : format}`
      : '';
    if (!ACCEPTED.has(mimeType)) {
      throw new BadRequestException(
        `Formato no admitido${format ? ` (${format})` : ''}. Usa JPG, PNG, WebP, HEIC o AVIF.`,
      );
    }

    const checksum = this.security.checksum(buffer);
    const id = randomUUID();
    const dir = join(this.root, scope);
    await mkdir(dir, { recursive: true });

    const width = meta.width ?? 0;
    const height = meta.height ?? 0;

    const base = `${scope}/${id}`;
    const originalKey = `${base}-o.webp`;

    /*
      El negativo se genera y se guarda ANTES de revelar nada.

      Es una pasada mas —decodificar el fichero del usuario, rotarlo por EXIF y
      reducirlo a 2560 px—, y a partir de ahi todo sale de el: el revelado se
      analiza y se aplica sobre el negativo, no sobre el fichero de entrada.
      Asi una foto subida hoy y la misma foto revelada manana por el proceso de
      las 6.306 antiguas dan exactamente el mismo resultado, en lugar de dos
      revelados parecidos que nadie sabria comparar.
    */
    const negativo = await sharp(buffer, {
      limitInputPixels: MAX_INPUT_PIXELS,
      pages: 1,
    })
      .rotate() // respeta la orientacion EXIF
      .resize({ width: ARCHIVE_WIDTH, withoutEnlargement: true })
      .webp({ quality: 86, effort: 3 })
      .toBuffer();
    await this.escribirEntero(`${base}${RAW_SUFFIX}`, negativo);
    const bytesSinRevelar = await this.asegurarSinRevelar(base, negativo);

    const revelado = revelar
      ? this.develop.plan(await this.develop.analizar(negativo, metrics))
      : null;

    const bytes = await this.generarVariantes(base, negativo, revelado);

    return {
      key: originalKey,
      url: this.publicUrl(`${base}-t.webp`),
      urlMedium: this.publicUrl(`${base}-m.webp`),
      urlLarge: this.publicUrl(`${base}-l.webp`),
      urlOriginal: this.publicUrl(originalKey),
      width,
      height,
      bytes: bytes + negativo.length + bytesSinRevelar,
      mimeType: 'image/webp',
      checksum,
      revelado,
      urlRaw: this.publicUrl(`${base}-rt.webp`),
      urlRawLarge: this.publicUrl(`${base}-rl.webp`),
    };
  }

  /**
   * Genera las cuatro variantes desde el negativo y devuelve lo que ocupan.
   *
   * Cascada: se decodifica el negativo una vez y cada tamano se deriva del
   * inmediatamente mayor. Antes se decodificaba tres veces el fichero
   * completo, que con fotos de 11 megapixeles es lo que hacia lento el
   * proceso.
   *
   * El revelado se aplica UNA vez, en el paso mas grande, y desde ahi se hereda
   * a los demas. El enfoque, al reves, va en cada paso que reduce de verdad:
   * es la reduccion la que emborrona, y aplicarlo solo arriba se pierde por el
   * camino hasta la miniatura, que es la imagen que mas se mira en el listado.
   */
  private async generarVariantes(
    base: string,
    negativo: Buffer,
    revelado: Revelado | null,
    variantes: readonly {
      sufijo: string;
      ancho: number;
      calidad: number;
    }[] = VARIANTES,
    caja: Caja | null = null,
  ): Promise<number> {
    /*
      El recorte se aplica ANTES que nada y una sola vez, sobre el negativo.

      Antes de reducir porque recortar y luego reducir conserva mas detalle que
      al reves, y una sola vez porque de la variante mas grande heredan las
      demas: recortarlas todas por separado seria recortar cuatro veces la
      misma fraccion y acabar con cuatro encuadres distintos por redondeo.
    */
    let anterior = caja ? await recortar(negativo, caja) : negativo;
    let anchoPrevio = (await sharp(anterior).metadata()).width ?? ARCHIVE_WIDTH;
    let total = 0;

    for (const [indice, variante] of variantes.entries()) {
      /*
        Sin revelado que aplicar, el archivo ES el negativo: se copia tal cual.

        Es el camino que recorre el deshacer, y reencodear ahi seria perder
        calidad justo en la operacion que existe para no perder nada: un
        webp de calidad 86 recomprimido a 86 no vuelve a los mismos pixeles.
        Asi deshacer devuelve el archivo byte a byte, y de paso se ahorra la
        pasada mas cara de las cuatro.
      */
      if (indice === 0 && !revelado && !caja && anchoPrevio <= variante.ancho) {
        total += anterior.length;
        await this.escribirEntero(`${base}${variante.sufijo}`, anterior);
        continue;
      }

      let pipe = sharp(anterior).resize({
        width: variante.ancho,
        withoutEnlargement: true,
      });
      if (indice === 0) pipe = this.develop.aplicar(pipe, revelado);
      /*
        El enfoque de salida es una de las cuatro operaciones del revelado, no
        un arreglo tecnico aparte. Asi que sin revelado tampoco se enfoca: es lo
        que hace que "deshacer" devuelva la foto como estaba y que el "antes"
        que se publica para comparar sea de verdad un antes, y no un antes ya
        con parte del despues puesto.
      */
      pipe = this.develop.enfoque(
        pipe,
        !!revelado && anchoPrevio > variante.ancho,
      );

      anterior = await pipe
        .webp({ quality: variante.calidad, effort: 3 })
        .toBuffer();
      anchoPrevio = Math.min(anchoPrevio, variante.ancho);
      total += anterior.length;
      await this.escribirEntero(`${base}${variante.sufijo}`, anterior);
    }
    return total;
  }

  /**
   * Vuelve a generar las cuatro variantes de una foto ya guardada.
   *
   * Es a la vez el revelado de lo antiguo y el deshacer: con `revelado` puesto
   * aplica ese, con null deja la foto como salio de la camara. Parte siempre
   * del negativo, asi que revelar dos veces no acumula nada — se revela sobre
   * el mismo punto de partida, no sobre lo ya revelado.
   *
   * Devuelve tambien el analisis, porque quien llama —el proceso de las 6.306—
   * decide con el si merece la pena tocar la foto.
   */
  async rerevelar(
    storageKey: string,
    decidir: (
      analisis: Awaited<ReturnType<ImageDevelopService['analizar']>>,
    ) => Revelado | null,
    /**
     * El recorte que ya tenia la foto, si tenia alguno.
     *
     * Va como parametro porque quien lo sabe es la fila, no el disco: las
     * variantes recortadas no se distinguen de una foto que se encuadro asi.
     * Sin esto, volver a revelar una foto recortada le quitaba el recorte y
     * dejaba la fila diciendo que estaba recortada — y el que mas lo habria
     * hecho es el proceso de las 6.306, en una sola pasada y sin decir nada.
     */
    caja: Caja | null = null,
  ): Promise<{
    revelado: Revelado | null;
    bytes: number;
    urlRaw: string;
    urlRawLarge: string;
  }> {
    const base = storageKey.replace(/-o\.webp$/, '');
    const negativo = await this.leerNegativo(base);
    const bytesSinRevelar = await this.asegurarSinRevelar(base, negativo, caja);
    /*
      El revelado se mide sobre el negativo ENTERO, no sobre el recorte.

      Asi recortar una foto no le cambia el revelado: si se midiera sobre lo
      recortado, quitar una franja de suelo oscuro subiria la exposicion del
      resto y la foto cambiaria de aspecto al recortarla, que no es lo que
      nadie espera de un recorte.
    */
    const revelado = decidir(await this.develop.analizar(negativo));
    const bytes = await this.generarVariantes(
      base,
      negativo,
      revelado,
      VARIANTES,
      caja,
    );
    return {
      revelado,
      bytes: bytes + negativo.length + bytesSinRevelar,
      urlRaw: this.publicUrl(`${base}-rt.webp`),
      urlRawLarge: this.publicUrl(`${base}-rl.webp`),
    };
  }

  /**
   * Recorta una foto ya guardada, o le quita el recorte.
   *
   * Parte del negativo y le vuelve a aplicar SU revelado, asi que recortar no
   * pierde el revelado ni lo aplica dos veces, y recortar dos veces no acumula:
   * la segunda caja se mide sobre la foto entera, no sobre la ya recortada. Con
   * `caja` a null se deshace y la foto vuelve a estar completa.
   *
   * Es la misma mecanica que `rerevelar` y a proposito: en este modulo, toda
   * operacion sobre una foto se guarda como una decision y se aplica
   * regenerando desde el negativo. Una operacion que escribiera sobre el
   * archivo publicado seria la unica que no se puede deshacer.
   */
  async recortar(
    storageKey: string,
    caja: Caja | null,
    revelado: Revelado | null,
  ): Promise<{ bytes: number }> {
    const base = storageKey.replace(/-o\.webp$/, '');
    const negativo = await this.leerNegativo(base);
    const bytes = await this.generarVariantes(
      base,
      negativo,
      revelado,
      VARIANTES,
      caja,
    );
    // El "antes" tiene que llevar el mismo recorte que el "despues": si no, el
    // comparador enseña una foto entera al lado de una recortada y quien mira
    // concluye que el revelado le ha comido un trozo a la foto.
    const bytesSinRevelar = await this.asegurarSinRevelar(base, negativo, caja);
    return { bytes: bytes + bytesSinRevelar };
  }

  /**
   * Publica el "antes" en tamano de listado y de ficha, si no estaba ya.
   *
   * Existe por una razon muy concreta: sin esto, la unica forma de MIRAR como
   * era la foto antes del revelado era quitarle el revelado de verdad, o sea
   * escribir sobre la foto publicada para poder mirarla. Eso no es comparar,
   * es un experimento sobre el anuncio de un cliente.
   *
   * Se salta si ya existen porque el negativo no cambia nunca: rerevelar una
   * foto veinte veces no vuelve a generar su "antes" ni una sola.
   *
   * Con recorte SI se rehace, porque entonces el "antes" ya no es el mismo
   * encuadre. Solo lo pagan las fotos recortadas, que son las pocas en las que
   * alguien acepto una propuesta.
   */
  private async asegurarSinRevelar(
    base: string,
    negativo: Buffer,
    caja: Caja | null = null,
  ): Promise<number> {
    if (!caja && (await this.fileExists(`${base}-rt.webp`))) return 0;
    return this.generarVariantes(
      base,
      negativo,
      null,
      VARIANTES_SIN_REVELAR,
      caja,
    );
  }

  /**
   * El negativo de una foto, creandolo desde el archivo si aun no existe.
   *
   * Las 6.306 fotos que ya estaban se guardaron antes de que hubiera negativo,
   * pero su `-o.webp` ES el archivo sin revelar: se copia tal cual, sin
   * reencodear, y a partir de ese momento la foto es reversible como las
   * nuevas. Copiar y no reencodear no es un detalle: reencodear el archivo
   * seria perder calidad justo en la copia que existe para no perder nada.
   */
  private async leerNegativo(base: string): Promise<Buffer> {
    const negativoPath = join(this.root, `${base}${RAW_SUFFIX}`);
    try {
      return await readFile(negativoPath);
    } catch {
      const archivo = await readFile(join(this.root, `${base}-o.webp`));
      await this.escribirEntero(`${base}${RAW_SUFFIX}`, archivo);
      return archivo;
    }
  }

  /**
   * Escribe el fichero entero o no lo escribe.
   *
   * Se escribe a un nombre temporal y se renombra al definitivo, que dentro
   * del mismo sistema de ficheros es atomico: o el fichero esta completo o no
   * esta. Con `writeFile` directo, un proceso que se corta a media escritura
   * —un despliegue, un OOM, una importacion interrumpida— deja un webp a
   * medias con su nombre bueno, y a partir de ahi es un fichero que existe,
   * que la base nombra y que ningun decodificador abre. En `uploads/` hay dos
   * asi, de 512 KiB clavados, de una importacion que se corto.
   *
   * Si el renombrado falla se limpia el temporal: un `.tmp` olvidado no lo
   * nombra nadie, pero ocupa.
   */
  private async escribirEntero(key: string, datos: Buffer): Promise<void> {
    const destino = join(this.root, key);
    const temporal = `${destino}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporal, datos);
      await rename(temporal, destino);
    } catch (error) {
      await rm(temporal, { force: true });
      throw error;
    }
  }

  /**
   * Descarga una imagen remota y la guarda. Devuelve null si la descarga falla:
   * en una importacion de 6.340 fotos, una URL caida no puede abortar el lote.
   */
  async saveFromUrl(
    url: string,
    scope: string,
    { timeoutMs = 20_000, maxBytes = 25 * 1024 * 1024 } = {},
  ): Promise<StoredImage | null> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, { signal: controller.signal });
      if (!res.ok) {
        this.logger.warn(`HTTP ${res.status} al descargar ${url}`);
        return null;
      }

      const declared = Number(res.headers.get('content-length') ?? 0);
      if (declared > maxBytes) {
        this.logger.warn(
          `Imagen descartada por tamano (${declared} bytes): ${url}`,
        );
        return null;
      }

      const buffer = Buffer.from(await res.arrayBuffer());
      if (buffer.length > maxBytes) {
        this.logger.warn(
          `Imagen descartada por tamano (${buffer.length} bytes): ${url}`,
        );
        return null;
      }

      return await this.saveImage(buffer, scope, url);
    } catch (error) {
      this.logger.warn(
        `No se pudo descargar ${url}: ${error instanceof Error ? error.message : String(error)}`,
      );
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Guarda un documento tal cual, sin procesarlo y FUERA de lo que se sirve.
   *
   * Sin reencodear porque una escritura es un PDF que hay que conservar byte a
   * byte. Y fuera de `/media/` porque su contenido es la cedula y las
   * escrituras de una persona: se piden por un endpoint que comprueba quien
   * pregunta, no por una URL que vale para cualquiera que la tenga.
   *
   * No devuelve `url`: no hay ninguna publica, y devolver uno invitaria a
   * pintarlo en un `<a href>` que no llevaria credencial.
   */
  async savePrivate(
    buffer: Buffer,
    scope: string,
    originalName: string,
    { maxBytes = 10 * 1024 * 1024 } = {},
  ): Promise<{
    key: string;
    bytes: number;
    originalName: string;
  }> {
    const safeName = sanitizeName(originalName);
    if (buffer.length > maxBytes) {
      throw new BadRequestException(
        `"${safeName}" pesa mas de ${Math.round(maxBytes / 1024 / 1024)} MB`,
      );
    }

    // Un documento no se reencodea, asi que la inspeccion es lo unico que hay
    // entre el fichero del usuario y el disco: aqui se apura mas — firma real,
    // rechazo de poliglotas y de PDF con acciones automaticas.
    const sniffed = await this.security.inspect(buffer, safeName, [
      'document',
      'image',
    ]);

    // El nombre en disco es un uuid y la extension sale de la firma, no del
    // nombre que envio el usuario: no hay travesia de rutas ni doble extension.
    const key = `${scope}/${randomUUID()}.${sniffed.extension}`;
    await mkdir(join(this.privateRoot, scope), { recursive: true });
    // 0600: el proceso lee y escribe; nadie mas en la maquina.
    await writeFile(join(this.privateRoot, key), buffer, { mode: 0o600 });

    return { key, bytes: buffer.length, originalName: safeName };
  }

  /**
   * Ruta en disco de un documento privado.
   *
   * La clave sale de la base, no de la URL, pero se comprueba igualmente que
   * el resultado caiga dentro de `privateRoot`: el dia que alguien exponga un
   * endpoint que acepte la clave desde fuera, `../../etc/passwd` ya esta
   * cerrado.
   */
  privatePath(key: string): string {
    const path = resolve(this.privateRoot, key);
    if (path !== this.privateRoot && !path.startsWith(this.privateRoot + sep)) {
      throw new BadRequestException('Ruta de documento invalida');
    }
    return path;
  }

  /**
   * Le pone marca de version a una URL ya publicada.
   *
   * `/media/` se sirve con `immutable` y un ano de cache. Eso es lo correcto
   * mientras un fichero no cambie nunca — y hasta ahora no cambiaba—, pero el
   * revelado reescribe las cuatro variantes SIN cambiar de nombre: sin esta
   * marca, quien ya hubiera abierto la ficha —y el proxy que tenga delante—
   * seguiria viendo la foto vieja durante un ano, y deshacer un revelado malo
   * no se notaria en el sitio.
   *
   * Cambiar el nombre del fichero en su lugar obligaria a reescribir cuatro
   * columnas mas la clave de almacenamiento y a borrar los ficheros viejos, o
   * sea a que un corte a mitad dejara filas apuntando a lo que ya no esta. La
   * marca en la consulta la ignora `express.static` para localizar el fichero
   * y la tiene en cuenta el navegador para la cache, que es justo el reparto
   * que hace falta.
   */
  static marcarVersion(url: string): string {
    return `${url.split('?')[0]}?r=${Date.now().toString(36)}`;
  }

  /** Borra las tres variantes a partir de la clave del original. */
  async remove(key: string): Promise<void> {
    if (!key) return;
    const base = key.replace(/-o\.webp$/, '');
    await Promise.all(
      [
        '-t.webp',
        '-m.webp',
        '-l.webp',
        '-o.webp',
        '-rt.webp',
        '-rl.webp',
        RAW_SUFFIX,
      ].map((suffix) =>
        rm(join(this.root, `${base}${suffix}`), { force: true }),
      ),
    );
  }

  /** Borra la carpeta completa de una entidad, en los dos almacenes. */
  async removeScope(scope: string): Promise<void> {
    await rm(join(this.root, scope), { recursive: true, force: true });
    await rm(join(this.privateRoot, scope), { recursive: true, force: true });
  }

  /** Estado del almacenamiento, para diagnostico. */
  usage(): { root: string; exists: boolean } {
    return { root: this.root, exists: existsSync(this.root) };
  }

  async ensureRoot(): Promise<void> {
    await mkdir(this.root, { recursive: true });
    // 0700: la carpeta de documentos no la lista nadie mas.
    await mkdir(this.privateRoot, { recursive: true, mode: 0o700 });
  }

  async fileExists(key: string): Promise<boolean> {
    try {
      await stat(join(this.root, key));
      return true;
    } catch {
      return false;
    }
  }

  /** Ruta absoluta en disco; solo la usa el servido estatico. */
  absolute(key: string): string {
    const full = resolve(this.root, key);
    // Defensa contra `../`: nunca se sale de `uploads/`.
    if (!full.startsWith(this.root)) {
      throw new BadRequestException('Ruta de archivo invalida');
    }
    return full;
  }

  static directoryOf(key: string): string {
    return dirname(key);
  }
}

/**
 * Aplica una caja en fracciones sobre una imagen.
 *
 * Se redondea hacia dentro y se exige al menos un pixel por lado: una caja de
 * 0,999 sobre una miniatura puede dar 0 de ancho al redondear, y sharp falla
 * con un error que no dice nada. Antes de eso, la caja se acota al marco — una
 * caja que se sale no es un error del que la manda, es aritmetica de
 * fracciones.
 */
async function recortar(buffer: Buffer, caja: Caja): Promise<Buffer> {
  const meta = await sharp(buffer).metadata();
  const w = meta.width ?? 0;
  const h = meta.height ?? 0;
  if (!w || !h) return buffer;

  const left = Math.min(w - 1, Math.max(0, Math.round(caja.x * w)));
  const top = Math.min(h - 1, Math.max(0, Math.round(caja.y * h)));
  const width = Math.max(1, Math.min(w - left, Math.round(caja.ancho * w)));
  const height = Math.max(1, Math.min(h - top, Math.round(caja.alto * h)));

  if (left === 0 && top === 0 && width === w && height === h) return buffer;
  return sharp(buffer).extract({ left, top, width, height }).toBuffer();
}
