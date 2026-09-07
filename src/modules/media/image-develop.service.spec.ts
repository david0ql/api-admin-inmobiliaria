import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { ImageDevelopService } from './image-develop.service';
import { StorageService } from './storage.service';
import type { AppConfigService } from '../../shared/config/app-config.service';
import type { FileSecurityService } from './file-security.service';

/**
 * El revelado automatico.
 *
 * Lo que se vigila aqui no es que el revelado mejore una foto —eso se mira, no
 * se afirma en un test— sino las tres promesas que sostienen tenerlo encendido
 * por defecto sobre fotos de inmuebles de clientes reales:
 *
 * 1. Que a una foto que no lo necesita NO se le hace nada. Aclarar una foto
 *    bien expuesta la estropea, y el placeholder blanco de "sin imagen" —125
 *    copias en el inventario— no tiene nada que revelar.
 * 2. Que el contraste nunca se paga con la luz de la estancia: en un inmueble
 *    la luz es lo que se vende.
 * 3. Que se puede deshacer. El original se guarda aparte y volver atras
 *    devuelve exactamente los mismos pixeles.
 */
describe('ImageDevelopService: el revelado', () => {
  const develop = new ImageDevelopService();

  /** Una imagen plana de un color: sirve de escena controlada. */
  function lienzo(
    r: number,
    g: number,
    b: number,
    ancho = 400,
    alto = 300,
  ): sharp.Sharp {
    return sharp({
      create: {
        width: ancho,
        height: alto,
        channels: 3,
        background: { r, g, b },
      },
    });
  }

  /**
   * Una foto de interior de mentira: pared clara, suelo medio y un mueble
   * oscuro. Con `desplaza` se simula la foto lavada —todo el histograma
   * apretado en la parte alta— y con `tinte` una dominante de color.
   */
  async function interior({
    desplaza = 0,
    comprime = 1,
    tinte = { r: 1, g: 1, b: 1 },
  } = {}): Promise<Buffer> {
    const tono = (v: number) => {
      const y = Math.min(255, Math.max(0, v * comprime + desplaza));
      return {
        r: Math.min(255, y * tinte.r),
        g: Math.min(255, y * tinte.g),
        b: Math.min(255, y * tinte.b),
      };
    };
    const pared = tono(250);
    const suelo = tono(130);
    const mueble = tono(6);
    return sharp({
      create: {
        width: 400,
        height: 300,
        channels: 3,
        background: {
          r: Math.round(pared.r),
          g: Math.round(pared.g),
          b: Math.round(pared.b),
        },
      },
    })
      .composite([
        {
          input: await lienzo(
            Math.round(suelo.r),
            Math.round(suelo.g),
            Math.round(suelo.b),
            400,
            120,
          )
            .png()
            .toBuffer(),
          top: 180,
          left: 0,
        },
        {
          input: await lienzo(
            Math.round(mueble.r),
            Math.round(mueble.g),
            Math.round(mueble.b),
            120,
            100,
          )
            .png()
            .toBuffer(),
          top: 60,
          left: 40,
        },
      ])
      .png()
      .toBuffer();
  }

  it('no toca una foto que ya llega de negro a blanco', async () => {
    const foto = await interior();
    const plan = develop.plan(await develop.analizar(foto));

    // Va de 6 a 250: ya ocupa el rango entero, y estirarla mas solo aplastaria
    // los extremos.
    expect(plan?.niveles).toBeUndefined();
  });

  it('no toca el placeholder blanco de "sin imagen"', async () => {
    const blanco = await lienzo(252, 252, 252).png().toBuffer();
    expect(develop.plan(await develop.analizar(blanco))).toBeNull();
  });

  it('estira la foto lavada, pero sin pasar de la ganancia maxima', async () => {
    // Todo el histograma metido en la mitad alta: la foto de ventana quemada.
    const lavada = await interior({ comprime: 0.45, desplaza: 110 });
    const plan = develop.plan(await develop.analizar(lavada));

    expect(plan?.niveles).toBeDefined();
    expect(plan!.niveles!.g).toBeGreaterThan(1.02);
    expect(plan!.niveles!.g).toBeLessThanOrEqual(1.2);
  });

  /*
    Este es el limite que se puso DESPUES de mirar las fotos.

    Con la ganancia a 1,25 un lavadero de paredes blancas salia gris sucio: el
    "punto negro" de una habitacion blanca no es negro, es su esquina en
    sombra, y estirar contra el oscurece la estancia entera. Una estancia clara
    que sale mas oscura parece mas pequena, y eso es exactamente lo contrario
    de lo que se busca.
  */
  it('nunca oscurece la foto mas de un 12 %', async () => {
    for (const opciones of [
      { comprime: 0.4, desplaza: 130 },
      { comprime: 0.5, desplaza: 100 },
      { comprime: 0.8, desplaza: 40 },
    ]) {
      const foto = await interior(opciones);
      const analisis = await develop.analizar(foto);
      const plan = develop.plan(analisis);
      const despues =
        analisis.brillo * (plan?.niveles?.g ?? 1) + (plan?.niveles?.b ?? 0);

      expect(despues).toBeGreaterThanOrEqual(analisis.brillo * 0.88 - 0.5);
    }
  });

  it('corrige la dominante de las superficies claras, amortiguada', async () => {
    const azulada = await interior({ tinte: { r: 0.88, g: 0.95, b: 1 } });
    const plan = develop.plan(await develop.analizar(azulada));

    expect(plan?.balance).toBeDefined();
    // Sube el rojo, baja el azul, y ninguno se mueve mas de un 7 %.
    expect(plan!.balance!.r).toBeGreaterThan(1);
    expect(plan!.balance!.b).toBeLessThan(1);
    for (const k of Object.values(plan!.balance!)) {
      expect(k).toBeGreaterThanOrEqual(0.93);
      expect(k).toBeLessThanOrEqual(1.07);
    }
  });

  /*
    El gris-mundo clasico —igualar las medias de los tres canales— enfriaba las
    cocinas de madera del inventario: tienen mas rojo por lo que hay, no por la
    luz. Aqui la escena es de madera de arriba abajo y no hay ninguna
    superficie clara neutra, asi que no hay referencia y no se toca el color.
  */
  it('no inventa una referencia de blanco donde no la hay', async () => {
    const madera = await lienzo(160, 96, 48).png().toBuffer();
    const plan = develop.plan(await develop.analizar(madera));

    expect(plan?.balance).toBeUndefined();
  });

  it('levanta los medios solo si la foto sigue oscura tras los niveles', async () => {
    const oscura = await interior({ comprime: 0.3 });
    const normal = await interior();

    expect(develop.plan(await develop.analizar(oscura))?.gamma).toBeGreaterThan(
      1,
    );
    expect(develop.plan(await develop.analizar(normal))?.gamma).toBeUndefined();
  });

  it('redacta en español lo que le hizo a la foto', async () => {
    const lavada = await interior({ comprime: 0.45, desplaza: 110 });
    const plan = develop.plan(await develop.analizar(lavada));

    /*
      El texto sale de aqui y no del panel a proposito: quien sabe que
      significa `g: 1.197` es este fichero. Con los numeros viajando solos, la
      pantalla acaba inventando una traduccion —"+0,4 EV"— que no es lo que
      hizo el codigo, porque esto no es un paso de exposicion, es una recta.
    */
    expect(plan!.resumen[0]).toMatch(
      /^Niveles automaticos: \+\d+ % de contraste$/,
    );
    expect(plan!.resumen.at(-1)).toContain('Enfoque de salida');
  });

  it('enfoca solo cuando el paso reduce de verdad', () => {
    const pipe = sharp({
      create: { width: 10, height: 10, channels: 3, background: '#fff' },
    });
    const espia = jest.spyOn(pipe, 'sharpen');

    develop.enfoque(pipe, false);
    expect(espia).not.toHaveBeenCalled();
    develop.enfoque(pipe, true);
    expect(espia).toHaveBeenCalledTimes(1);
  });
});

/**
 * El deshacer, que es la parte innegociable.
 *
 * Son fotos de inmuebles de clientes reales y el revelado es automatico: si un
 * dia deja una foto peor, tiene que poder volverse atras sin volver a pedirle
 * la foto al propietario.
 */
describe('StorageService: el negativo y el deshacer', () => {
  let raiz: string;
  let storage: StorageService;

  beforeEach(async () => {
    raiz = await mkdtemp(join(tmpdir(), 'revelado-'));
    storage = new StorageService(
      {
        uploadsDir: raiz,
        uploadMaxBytes: 20 * 1024 * 1024,
      } as AppConfigService,
      // La inspeccion de seguridad tiene su propio test; aqui estorba.
      {
        inspect: () => Promise.resolve(undefined),
        checksum: () => 'x',
      } as unknown as FileSecurityService,
      new ImageDevelopService(),
    );
    await storage.ensureRoot();
  });

  afterEach(async () => {
    await rm(raiz, { recursive: true, force: true });
  });

  /** Una foto lavada de verdad, para que haya revelado que deshacer. */
  async function fotoLavada(): Promise<Buffer> {
    const ruido = Buffer.alloc(600 * 400 * 3);
    for (let i = 0; i < ruido.length; i += 3) {
      const y = 140 + Math.floor((i / 3) % 90);
      ruido[i] = y;
      ruido[i + 1] = y;
      ruido[i + 2] = y;
    }
    return sharp(ruido, { raw: { width: 600, height: 400, channels: 3 } })
      .jpeg()
      .toBuffer();
  }

  it('guarda el negativo intacto junto a las cuatro variantes', async () => {
    const guardada = await storage.saveImage(await fotoLavada(), 'pruebas');

    expect(guardada.revelado).not.toBeNull();
    const base = guardada.key.replace(/-o\.webp$/, '');
    for (const sufijo of ['-t', '-m', '-l', '-o', '-r']) {
      expect(existsSync(join(raiz, `${base}${sufijo}.webp`))).toBe(true);
    }
  });

  it('deshacer devuelve exactamente la foto sin revelar', async () => {
    const guardada = await storage.saveImage(await fotoLavada(), 'pruebas');
    const revelada = await sharp(join(raiz, guardada.key)).raw().toBuffer();

    await storage.rerevelar(guardada.key, () => null);
    const sinRevelar = await sharp(join(raiz, guardada.key)).raw().toBuffer();

    expect(sinRevelar.equals(revelada)).toBe(false);

    // Y volver a revelar reproduce lo mismo que salio al subir: se revela
    // siempre desde el negativo, nunca sobre lo ya revelado.
    const { revelado } = await storage.rerevelar(guardada.key, (a) =>
      new ImageDevelopService().plan(a),
    );
    expect(revelado).toEqual(guardada.revelado);
    const otraVez = await sharp(join(raiz, guardada.key)).raw().toBuffer();
    expect(otraVez.equals(revelada)).toBe(true);
  });

  /*
    Las 6.306 fotos de produccion se guardaron sin negativo, pero su `-o.webp`
    es el archivo sin revelar. Se copia tal cual la primera vez que se toca la
    foto —sin reencodear, que seria perder calidad justo en la copia que existe
    para no perder nada— y a partir de ahi es reversible como las nuevas.
  */
  it('crea el negativo de una foto antigua a partir de su archivo', async () => {
    const guardada = await storage.saveImage(
      await fotoLavada(),
      'pruebas',
      '',
      {
        revelar: false,
      },
    );
    const base = guardada.key.replace(/-o\.webp$/, '');
    const negativo = join(raiz, `${base}-r.webp`);
    await rm(negativo);

    const { revelado } = await storage.rerevelar(guardada.key, (a) =>
      new ImageDevelopService().plan(a),
    );

    expect(existsSync(negativo)).toBe(true);
    expect(revelado).not.toBeNull();
  });

  /*
    Sin esto, la unica forma de MIRAR la foto sin revelar era quitarle el
    revelado de verdad: una escritura sobre el anuncio de un cliente para poder
    mirarlo. Y sin comparar no se puede contestar la pregunta que origino todo
    esto, que es si la foto se ve mejor.
  */
  it('publica la foto sin revelar en los dos tamanos que se miran', async () => {
    const guardada = await storage.saveImage(await fotoLavada(), 'pruebas');
    const base = guardada.key.replace(/-o\.webp$/, '');

    expect(guardada.urlRaw).toBe(`/media/${base}-rt.webp`);
    expect(guardada.urlRawLarge).toBe(`/media/${base}-rl.webp`);
    for (const sufijo of ['-rt', '-rl']) {
      expect(existsSync(join(raiz, `${base}${sufijo}.webp`))).toBe(true);
    }

    // Y es de verdad un "antes": no se parece a la version revelada del mismo
    // tamano. Un comparador que enseñe dos veces la misma foto es peor que no
    // tener comparador, porque afirma que no hubo cambio.
    const antes = await sharp(join(raiz, `${base}-rl.webp`))
      .raw()
      .toBuffer();
    const despues = await sharp(join(raiz, `${base}-l.webp`))
      .raw()
      .toBuffer();
    expect(antes.equals(despues)).toBe(false);
  });

  it('no rehace el "antes" al volver a revelar: el negativo no cambia', async () => {
    const guardada = await storage.saveImage(await fotoLavada(), 'pruebas');
    const base = guardada.key.replace(/-o\.webp$/, '');
    const antes = await readFile(join(raiz, `${base}-rt.webp`));

    await storage.rerevelar(guardada.key, () => null);
    await storage.rerevelar(guardada.key, (a) =>
      new ImageDevelopService().plan(a),
    );

    expect((await readFile(join(raiz, `${base}-rt.webp`))).equals(antes)).toBe(
      true,
    );
  });

  /*
    Revelar y encuadrar son dos decisiones distintas sobre la misma foto, y las
    dos se aplican regenerando desde el negativo. Eso las hace componibles, pero
    tambien hace facil que una borre la otra sin avisar: el que mas lo habria
    hecho es el proceso de las 6.306, en una sola pasada.
  */
  it('volver a revelar no le quita el recorte a la foto', async () => {
    const guardada = await storage.saveImage(await fotoLavada(), 'pruebas');
    const caja = { x: 0, y: 0, ancho: 1, alto: 0.7 };
    await storage.recortar(guardada.key, caja, guardada.revelado);
    const recortada = await sharp(join(raiz, guardada.key)).metadata();

    await storage.rerevelar(
      guardada.key,
      (a) => new ImageDevelopService().plan(a),
      caja,
    );

    const despues = await sharp(join(raiz, guardada.key)).metadata();
    expect(despues.height).toBe(recortada.height);
  });

  it('el "antes" lleva el mismo recorte que el "despues"', async () => {
    const guardada = await storage.saveImage(await fotoLavada(), 'pruebas');
    const base = guardada.key.replace(/-o\.webp$/, '');
    await storage.recortar(
      guardada.key,
      { x: 0, y: 0, ancho: 1, alto: 0.7 },
      guardada.revelado,
    );

    /*
      Si el "antes" se quedara entero, el comparador pondria una foto completa
      al lado de una recortada y quien mira concluiria que el revelado le ha
      comido un trozo a la foto. Un comparador que atribuye mal el cambio es
      peor que no tenerlo.
    */
    const antes = await sharp(join(raiz, `${base}-rl.webp`)).metadata();
    const despues = await sharp(join(raiz, `${base}-l.webp`)).metadata();
    expect(antes.width / antes.height).toBeCloseTo(
      despues.width / despues.height,
      2,
    );
  });

  it('marca la version en la URL para que la cache de un anio se entere', () => {
    const marcada = StorageService.marcarVersion('/media/x/y-l.webp');
    expect(marcada).toMatch(/^\/media\/x\/y-l\.webp\?r=/);
    // Marcar dos veces no encadena marcas.
    expect(StorageService.marcarVersion(marcada).split('?').length).toBe(2);
  });
});
