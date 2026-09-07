import { z } from 'zod';
import { RoomKind } from './domain/image-analysis.enums';
import { BORDES, type Borde, type CorteSugerido } from './framing';

/**
 * Lo que el modelo TIENE que devolver, y como se sobrevive a que no lo haga.
 *
 * Un modelo de lenguaje es una fuente de texto, no una API. Aunque se le pida
 * JSON estricto, va a inventarse una estancia que no esta en la lista, va a
 * puntuar 105 sobre 100 y algun dia va a devolver `"quality": "alta"`. Si eso
 * revienta el analisis del lote entero, la pantalla se queda en blanco y el
 * asesor no sabe por que.
 *
 * Asi que aqui nada es estricto salvo la FORMA: cada campo se recorta a su
 * rango, lo que no se reconoce cae a un valor por defecto sensato, y lo que
 * falta se rellena. La factura ya esta pagada cuando esto se ejecuta: tirar la
 * respuesta por un decimal fuera de sitio es tirar el dinero.
 *
 * El `.optional()` de cada campo NO es decorativo, y esta promesa ya se rompio
 * una vez por no tenerlo: en zod una clave AUSENTE no es lo mismo que una
 * clave con valor raro, y sin `.optional()` un `caption` que el modelo no
 * menciona hace fallar el lote entero con "expected nonoptional". Aqui la
 * ausencia es el caso normal —un modelo omite lo que no tiene que decir— y se
 * trata como tal. `image-analysis.contract.spec.ts` lo vigila.
 *
 * Lo que sí es estricto es que haya `images`: sin eso no hay respuesta que
 * guardar y hay que decirlo.
 */

/** Recorta un numero a un rango; lo que no sea numero cae al valor de reserva. */
const acotado = (min: number, max: number, porDefecto: number) =>
  z
    .unknown()
    .optional()
    .transform((v) => {
      const n = typeof v === 'number' ? v : Number(v);
      if (!Number.isFinite(n)) return porDefecto;
      return Math.min(max, Math.max(min, n));
    })
    .pipe(z.number());

/** Texto recortado a lo que cabe en la columna; lo que no sea texto, vacio. */
const texto = (max: number) =>
  z
    .unknown()
    .optional()
    .transform((v) => (typeof v === 'string' ? v.trim().slice(0, max) : ''))
    .pipe(z.string());

/** Lista de frases: se limpia, se recorta y se acota cuantas entran. */
const frases = (maxFrases: number, maxLargo: number) =>
  z
    .unknown()
    .optional()
    .transform((v) =>
      (Array.isArray(v) ? v : [])
        .filter((x): x is string => typeof x === 'string')
        .map((s) => s.trim().slice(0, maxLargo))
        .filter(Boolean)
        .slice(0, maxFrases),
    )
    .pipe(z.array(z.string()));

/**
 * La estancia. Lo que no este en el enum se convierte en `OTHER` en vez de
 * fallar: que el modelo diga "PATIO" no puede costar el analisis de las otras
 * diecinueve fotos del lote.
 */
const estancia = z
  .unknown()
  .optional()
  .transform((v) => {
    const s = typeof v === 'string' ? v.trim().toUpperCase() : '';
    return (Object.values(RoomKind) as string[]).includes(s)
      ? (s as RoomKind)
      : RoomKind.OTHER;
  })
  .pipe(z.enum(RoomKind));

export const privacySchema = z
  .unknown()
  .optional()
  .transform((v) => {
    const o = (typeof v === 'object' && v ? v : {}) as Record<string, unknown>;
    const b = (k: string) => o[k] === true || o[k] === 'true';
    const notes =
      typeof o.notes === 'string' ? o.notes.trim().slice(0, 300) : '';
    return {
      faces: b('faces'),
      plates: b('plates'),
      documents: b('documents'),
      screens: b('screens'),
      address: b('address'),
      // Un numero, no una bandera: se guarda para auditar y no decide nada.
      framedPeople: Number.isFinite(Number(o.framedPeople))
        ? Math.min(99, Math.max(0, Math.trunc(Number(o.framedPeople))))
        : 0,
      notes: notes || null,
    };
  })
  .pipe(
    z.object({
      faces: z.boolean(),
      plates: z.boolean(),
      documents: z.boolean(),
      screens: z.boolean(),
      address: z.boolean(),
      framedPeople: z.number(),
      notes: z.string().nullable(),
    }),
  );

/**
 * Lo que el modelo propone recortar, tal y como lo dice.
 *
 * Aqui NO se decide nada: se limpia. La entrada es una lista de bordes con una
 * cifra y una frase, y lo unico que se garantiza es que lo que salga tenga esa
 * forma. Quien decide si el corte se aplica es `resolverEncuadre`, cruzandolo
 * con lo que mide el codigo — y esa separacion es a proposito: lo que dice el
 * modelo se guarda tal cual para poder discutirlo despues, aunque no se ejecute.
 *
 * Blando como todo lo demas: un borde que no se reconoce se tira, pero no tumba
 * el analisis de las otras once fotos del lote. La factura ya esta pagada.
 */
const cortesSugeridos = z
  .unknown()
  .optional()
  .transform((v) => {
    const lista = Array.isArray(v) ? v : [];
    const salida: CorteSugerido[] = [];
    for (const item of lista.slice(0, 4)) {
      const o = (typeof item === 'object' && item ? item : {}) as Record<
        string,
        unknown
      >;
      const borde =
        typeof o.borde === 'string' ? o.borde.trim().toUpperCase() : '';
      if (!(BORDES as readonly string[]).includes(borde)) continue;
      const n = Number(o.porcion);
      /*
        La cifra del modelo se guarda pero se acota a 1-35 y nunca se ejecuta:
        esta medido que la subestima siempre —cuando la franja ocupaba el 40 %
        contestaba 10 o 15— asi que sirve para ver que dijo, no para recortar.
      */
      salida.push({
        borde: borde as Borde,
        porcion: Number.isFinite(n)
          ? Math.min(35, Math.max(1, Math.round(n)))
          : 1,
        que: typeof o.que === 'string' ? o.que.trim().slice(0, 120) : '',
      });
    }
    return salida;
  })
  .pipe(
    z.array(
      z.object({
        borde: z.enum(BORDES),
        porcion: z.number(),
        que: z.string(),
      }),
    ),
  );

/**
 * Antes de validar, se normaliza el nombre del campo del encuadre.
 *
 * El prompt vive en la base de datos y lo edita gente desde el panel, asi que
 * el dia que alguien lo reescriba y lo llame "retoque" —que es como se dice en
 * la agencia— el campo tiene que seguir llegando. Un renombrado en un texto que
 * se edita a mano no puede costar la funcion entera y en silencio.
 */
export const imageJudgementSchema = z.preprocess(
  (v) => {
    const o = (typeof v === 'object' && v ? v : {}) as Record<string, unknown>;
    if (o.encuadre === undefined && o.retoque !== undefined) {
      return { ...o, encuadre: o.retoque };
    }
    return o;
  },
  z.object({
    index: acotado(0, 999, 0),
    room: estancia,
    roomConfidence: acotado(0, 1, 0),
    quality: acotado(0, 100, 50),
    coverScore: acotado(0, 100, 0),
    caption: texto(300),
    issues: frases(5, 200),
    fixes: frases(5, 200),
    privacy: privacySchema,
    /*
    El modelo lo manda dentro de `retoque` porque asi se le pide en el prompt y
    asi lo entiende mejor —el objeto le da un sitio donde pensar el encuadre—,
    pero aqui se aplana: lo que se guarda es una lista, y un objeto de una sola
    clave alrededor solo seria una capa mas que abrir en la pantalla.

    Se acepta tambien la lista suelta y la clave en ingles: no cuesta nada y
    evita que un dia que alguien reescriba el prompt desde el panel el campo
    entero llegue vacio sin que nadie sepa por que.
  */
    encuadre: z
      .unknown()
      .optional()
      .transform((v) => {
        const o = (typeof v === 'object' && v ? v : {}) as Record<
          string,
          unknown
        >;
        return Array.isArray(v) ? v : (o.recorte ?? o.crop ?? o.cortes);
      })
      .pipe(cortesSugeridos),
    // Por defecto `true`: si el modelo no se pronuncia, la foto entra. Lo
    // contrario haria que un fallo del modelo escondiera fotos buenas y nadie
    // sabria por que faltan.
    usable: z
      .unknown()
      .optional()
      .transform((v) => v !== false && v !== 'false')
      .pipe(z.boolean()),
  }),
);

export const albumJudgementSchema = z.object({
  suggestedOrder: z
    .unknown()
    .optional()
    .transform((v) =>
      (Array.isArray(v) ? v : [])
        .map((x) => Number(x))
        .filter((n) => Number.isInteger(n) && n >= 0 && n < 1000)
        .slice(0, 200),
    )
    .pipe(z.array(z.number())),
  coverIndex: acotado(0, 999, 0),
  /*
    Se acepta lo que mande el modelo, pero NO se guarda: `missing` se calcula
    en codigo a partir de los `room` que el mismo acaba de asignar.

    Es una resta de conjuntos, y pedirsela a un modelo sale mal de una forma muy
    concreta: llega a decir que falta la cocina en un album donde acaba de
    clasificar una foto como KITCHEN. Se contradice consigo mismo en la misma
    respuesta. Lo mecanico va en codigo, igual que la resolucion y la
    orientacion; al modelo se le pregunta lo que solo el puede ver.
  */
  missing: z
    .unknown()
    .optional()
    .transform(() => [] as RoomKind[])
    .pipe(z.array(z.enum(RoomKind))),
  summary: texto(1000),
});

export const analysisResponseSchema = z.object({
  images: z.array(imageJudgementSchema).min(1),
  // El juicio de conjunto puede faltar sin que pase nada: un lote de una sola
  // foto no tiene orden que sugerir.
  album: albumJudgementSchema.optional(),
});

export type ImageJudgement = z.infer<typeof imageJudgementSchema>;
export type AlbumJudgement = z.infer<typeof albumJudgementSchema>;
export type AnalysisResponse = z.infer<typeof analysisResponseSchema>;

/**
 * Casa los juicios que devolvio el modelo con las fotos que se le mandaron.
 *
 * Existe porque el modelo NO devuelve fiablemente una entrada por imagen. Sobre
 * 50 llamadas reales, con tandas de 15 o 16 fotos se equivoca en el numero el
 * 47 % de las veces: unas inventa una entrada de mas y otras trunca en seco,
 * contestando doce juicios para quince fotos. El JSON es valido y no hay error.
 *
 * Casar por posicion en la lista seria creerse ese numero. Se casa por el
 * `index` que el propio modelo declara, se tira lo que cae fuera del tramo
 * enviado —una entrada 15 en una tanda de 12 no describe ninguna foto real, y
 * guardarla seria inventarse un juicio— y quien llama comprueba despues que
 * estan todas.
 *
 * `enviadas` es cuantas fotos iban en la tanda, no cuantas contesto.
 */
export function casarPorIndice(
  juicios: ImageJudgement[],
  enviadas: number,
): Map<number, ImageJudgement> {
  const mapa = new Map<number, ImageJudgement>();
  for (const juicio of juicios) {
    if (juicio.index < 0 || juicio.index >= enviadas) continue;
    // El primero gana: si repite un indice, la segunda entrada es ruido.
    if (!mapa.has(juicio.index)) mapa.set(juicio.index, juicio);
  }
  return mapa;
}

/**
 * Saca el objeto de lo que devolvio el modelo.
 *
 * Con `response_format: json_object` deberia venir JSON limpio, pero los
 * modelos siguen envolviendolo en ```json a veces, sobre todo cuando alguien
 * edita el prompt desde el panel y le pide "responde en JSON" otra vez. Se
 * limpia en lugar de fallar.
 */
export function parseAnalysisResponse(raw: string): AnalysisResponse {
  const limpio = raw
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '')
    .trim();

  let objeto: unknown;
  try {
    objeto = JSON.parse(limpio);
  } catch {
    // Ultimo intento: quedarse con lo que hay entre la primera llave y la
    // ultima, por si el modelo le puso una frase delante.
    const inicio = limpio.indexOf('{');
    const fin = limpio.lastIndexOf('}');
    if (inicio === -1 || fin <= inicio) {
      throw new Error('El modelo no devolvio JSON');
    }
    objeto = JSON.parse(limpio.slice(inicio, fin + 1));
  }

  const parsed = analysisResponseSchema.safeParse(objeto);
  if (!parsed.success) {
    throw new Error(
      `La respuesta del modelo no tiene la forma esperada: ${parsed.error.issues
        .map((i) => `${i.path.join('.')} ${i.message}`)
        .join('; ')}`,
    );
  }
  return parsed.data;
}
