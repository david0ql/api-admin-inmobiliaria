import type { Locale } from '../i18n/domain/translation.entity';

/**
 * Lo poco que el servidor le escribe DIRECTAMENTE al visitante.
 *
 * Casi todo lo que sale del chat lo redacta el modelo, y el prompt ya le manda
 * escribir siempre en el idioma del visitante. Pero hay cuatro frases que no
 * pasan por el modelo —las que se emiten precisamente cuando el modelo no
 * contesta o no está—, y sin esto se colaban en español en la web inglesa,
 * justo en el peor momento: el único mensaje que no entiende es el que le dice
 * que algo falló.
 *
 * Son cuatro: se resuelven aquí, a mano, y no por el diccionario de la web. Ese
 * vive en la base y se lee con una consulta; el camino de error no es sitio
 * para depender de que la base conteste.
 */
const TEXTOS = {
  /** Se acabaron los pasos con el modelo aún pidiendo herramientas. */
  enredado: {
    es: 'Disculpa, se me enredó la consulta. ¿Puedes repetirme qué necesitas?',
    en: 'Sorry, I got tangled up there. Could you tell me again what you need?',
  },
  /** Falló la llamada al modelo a mitad del turno. */
  fallo: {
    es: 'El asistente tuvo un problema. Inténtalo de nuevo en un momento.',
    en: 'The assistant ran into a problem. Please try again in a moment.',
  },
  /** El chat está apagado por configuración. */
  apagado: {
    es: 'El asistente no está disponible en este momento.',
    en: 'The assistant is not available right now.',
  },
} satisfies Record<string, Record<Locale, string>>;

export type TextoAsistente = keyof typeof TEXTOS;

/** La frase en el idioma del visitante; en español si no dijo otra cosa. */
export function texto(clave: TextoAsistente, locale: Locale = 'es'): string {
  return TEXTOS[clave][locale] ?? TEXTOS[clave].es;
}
