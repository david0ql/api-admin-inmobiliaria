import { COSTES_PUBLICADOS } from './retouch-frontier';

/**
 * Los nombres de los campos de coste, vigilados.
 *
 * Esta prueba no comprueba una funcion: comprueba un contrato con otra
 * pantalla, y existe porque ese contrato ya se rompio DOS veces seguidas por
 * lo mismo. El sintoma nunca fue un error —ni una excepcion, ni un 500, ni una
 * linea en un log—: simplemente el panel dejaba de encontrar el campo, la
 * frase "unas 490 veces lo que cuesta analizarla" no se pintaba, y el asesor
 * veia un importe suelto sin nada que le dijera si es caro. Que es justo lo
 * que esa frase existia para arreglar.
 *
 * La primera vez fue porque el panel leia `costeAnalisisUsd` y aqui se
 * publicaba `analisisUsd`. La segunda fue al reves: se renombro para que
 * casara, y para entonces el panel ya se habia adaptado a lo que servia
 * produccion, con lo que el arreglo se convirtio en el fallo siguiente.
 *
 * Un renombrado que "solo es cosmetico" en un campo publicado con consumidor
 * vivo no es cosmetico. Si alguien vuelve a tocarlos, que falle aqui y no en
 * una pantalla donde no se nota.
 */
describe('nombres de los campos de coste publicados', () => {
  it('son exactamente los que lee el panel', () => {
    expect(COSTES_PUBLICADOS).toEqual(['analisisUsd', 'moneda', 'retoqueUsd']);
  });
});
