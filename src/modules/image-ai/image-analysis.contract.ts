import { z } from 'zod';
import { RoomKind } from './domain/image-analysis.enums';

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
 * Lo que sí es estricto es que haya `images`: sin eso no hay respuesta que
 * guardar y hay que decirlo.
 */

/** Recorta un numero a un rango; lo que no sea numero cae al valor de reserva. */
const acotado = (min: number, max: number, porDefecto: number) =>
  z
    .unknown()
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
    .transform((v) => (typeof v === 'string' ? v.trim().slice(0, max) : ''))
    .pipe(z.string());

/** Lista de frases: se limpia, se recorta y se acota cuantas entran. */
const frases = (maxFrases: number, maxLargo: number) =>
  z
    .unknown()
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
  .transform((v) => {
    const s = typeof v === 'string' ? v.trim().toUpperCase() : '';
    return (Object.values(RoomKind) as string[]).includes(s)
      ? (s as RoomKind)
      : RoomKind.OTHER;
  })
  .pipe(z.enum(RoomKind));

export const privacySchema = z
  .unknown()
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
      notes: z.string().nullable(),
    }),
  );

export const imageJudgementSchema = z.object({
  index: acotado(0, 999, 0),
  room: estancia,
  roomConfidence: acotado(0, 1, 0),
  quality: acotado(0, 100, 50),
  coverScore: acotado(0, 100, 0),
  caption: texto(300),
  issues: frases(5, 200),
  fixes: frases(5, 200),
  privacy: privacySchema,
  // Por defecto `true`: si el modelo no se pronuncia, la foto entra. Lo
  // contrario haria que un fallo del modelo escondiera fotos buenas y nadie
  // sabria por que faltan.
  usable: z
    .unknown()
    .transform((v) => v !== false && v !== 'false')
    .pipe(z.boolean()),
});

export const albumJudgementSchema = z.object({
  suggestedOrder: z
    .unknown()
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
