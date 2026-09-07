import { ImageRetouch } from './domain/image-retouch.entity';
import { RetouchStatus } from './domain/image-retouch.enums';

/**
 * La forma que consume el panel, que NO es la forma que guarda la base.
 *
 * Existe una traduccion en medio a proposito. El panel se escribio contra un
 * contrato acordado —`estado`, `coste`, `moneda`, `urlResultado`— y la tabla
 * guarda mas cosas y con otros nombres, porque tiene que contestar preguntas
 * que la pantalla no hace: cuanto se ha gastado en total, que se pidio
 * exactamente, quien lo confirmo, con que prompt salio. Atar la una a la otra
 * obligaria a que cualquier columna nueva de auditoria fuera un cambio de la
 * interfaz.
 *
 * `moneda` va explicita en cada respuesta y no dada por supuesta: la agencia
 * factura en pesos y esto se paga en dolares. Un numero sin moneda al lado, en
 * una pantalla donde se decide un gasto, es una cifra que alguien va a leer mal.
 */
export interface RetoquePanel {
  id: string;
  propertyImageId: string;
  estado: EstadoPanel;
  motivo: string | null;
  thumbResultado: string | null;
  urlResultado: string | null;
  coste: number | null;
  moneda: string;
  createdAt: string;
}

export type EstadoPanel =
  'PROCESANDO' | 'LISTO' | 'ACEPTADO' | 'DESCARTADO' | 'FALLIDO';

/**
 * Los estados de dentro no son los de fuera, y la diferencia es informativa.
 *
 * `REVERTIDO` se enseña como `DESCARTADO` porque para la pantalla las dos cosas
 * significan lo mismo —la foto que se ve es la real— y un estado mas en el
 * `switch` del panel no le contaria nada nuevo a nadie. Por dentro si se
 * distinguen: descartar es "no me gusto y ni lo publique" y revertir es "lo
 * publique y me eche atras", que no es la misma historia cuando alguien
 * pregunte que paso con una foto.
 */
const ESTADOS: Record<RetouchStatus, EstadoPanel> = {
  [RetouchStatus.PROCESANDO]: 'PROCESANDO',
  [RetouchStatus.PENDIENTE]: 'LISTO',
  [RetouchStatus.APLICADO]: 'ACEPTADO',
  [RetouchStatus.DESCARTADO]: 'DESCARTADO',
  [RetouchStatus.REVERTIDO]: 'DESCARTADO',
  [RetouchStatus.FALLIDO]: 'FALLIDO',
};

export function aPanel(fila: ImageRetouch): RetoquePanel {
  return {
    id: fila.id,
    propertyImageId: fila.propertyImageId,
    estado: ESTADOS[fila.status],
    motivo: fila.error,
    thumbResultado: fila.retouchedSnapshot?.url ?? null,
    urlResultado: fila.retouchedSnapshot?.urlLarge ?? null,
    /*
      El coste real de ESTA llamada, no el orientativo. Mientras esta
      PROCESANDO todavia no se sabe —el proveedor no ha dicho los tokens— y va
      nulo, que es la verdad; inventar aqui el precio de tarifa seria enseñar
      como hecho un numero que puede no ser el que se cobre.
    */
    coste:
      fila.status === RetouchStatus.PROCESANDO ? null : Number(fila.costUsd),
    moneda: 'USD',
    createdAt: fila.createdAt.toISOString(),
  };
}
