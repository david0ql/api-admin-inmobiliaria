import { aPanel } from './retouch-panel.contract';
import { ImageRetouch } from './domain/image-retouch.entity';
import { RetouchStatus } from './domain/image-retouch.enums';

/**
 * La traduccion a lo que consume la pantalla.
 *
 * Se vigila porque es una frontera entre dos modulos que escribieron dos
 * personas distintas: si alguien renombra un estado por dentro, lo que se rompe
 * no es una prueba, es un `switch` del panel que deja de pintar el boton de
 * aceptar — y el sintoma seria "el retoque no termina nunca".
 */
function fila(parcial: Partial<ImageRetouch>): ImageRetouch {
  return {
    id: 'r1',
    propertyImageId: 'i1',
    status: RetouchStatus.PENDIENTE,
    error: null,
    costUsd: '0.24533',
    retouchedSnapshot: null,
    createdAt: new Date('2026-09-06T12:00:00Z'),
    ...parcial,
  } as ImageRetouch;
}

describe('aPanel', () => {
  it('mientras procesa no inventa un coste', () => {
    // Todavia no se sabe: el proveedor no ha dicho los tokens. Pintar aqui el
    // precio de tarifa seria enseñar como hecho un numero que puede no serlo.
    const panel = aPanel(fila({ status: RetouchStatus.PROCESANDO }));
    expect(panel.estado).toBe('PROCESANDO');
    expect(panel.coste).toBeNull();
  });

  it('un retoque hecho y sin decidir se enseña como LISTO', () => {
    expect(aPanel(fila({ status: RetouchStatus.PENDIENTE })).estado).toBe(
      'LISTO',
    );
  });

  it('revertido se enseña como descartado: para la pantalla es lo mismo', () => {
    // Por dentro si se distinguen —descartar es "ni lo publique" y revertir es
    // "lo publique y me eche atras"— pero el panel solo necesita saber que lo
    // que se ve ahora es la foto real.
    expect(aPanel(fila({ status: RetouchStatus.REVERTIDO })).estado).toBe(
      'DESCARTADO',
    );
    expect(aPanel(fila({ status: RetouchStatus.DESCARTADO })).estado).toBe(
      'DESCARTADO',
    );
  });

  it('todos los estados de dentro tienen traduccion', () => {
    // Sin esto, añadir un estado nuevo y olvidar el mapa daria `undefined` en
    // el `estado` del panel, que es un fallo mudo.
    for (const status of Object.values(RetouchStatus)) {
      expect(aPanel(fila({ status })).estado).toBeDefined();
    }
  });

  it('el coste siempre viaja con su moneda', () => {
    // La agencia factura en pesos y esto se paga en dolares. Un numero suelto
    // en una pantalla donde se decide un gasto es una cifra que se lee mal.
    const panel = aPanel(fila({ status: RetouchStatus.APLICADO }));
    expect(panel.estado).toBe('ACEPTADO');
    expect(panel.coste).toBe(0.24533);
    expect(panel.moneda).toBe('USD');
  });

  it('las urls del resultado son nulas si no hay imagen', () => {
    const panel = aPanel(fila({ status: RetouchStatus.FALLIDO, error: 'x' }));
    expect(panel.thumbResultado).toBeNull();
    expect(panel.urlResultado).toBeNull();
    expect(panel.motivo).toBe('x');
  });
});
