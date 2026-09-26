/**
 * Quita los caracteres de control (salvo tabulador y saltos de linea): un
 * solo byte de esos invalida un XML entero y hay portales que rechazan el
 * anuncio por ellos. Se filtra por codigo y no con una expresion regular para
 * que el fuente no lleve caracteres invisibles.
 */
export function stripControl(text: string): string {
  let out = '';
  for (const ch of text) {
    const code = ch.charCodeAt(0);
    if (code >= 32 || code === 9 || code === 10 || code === 13) out += ch;
  }
  return out;
}
