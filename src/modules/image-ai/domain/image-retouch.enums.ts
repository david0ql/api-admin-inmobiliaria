/**
 * Que se le pidio de verdad a la IA sobre una foto de un inmueble.
 *
 * No es una etiqueta decorativa: es la frontera entre revelar y falsear, y es
 * lo que decide si al asesor se le pide una confirmacion extra y con que
 * severidad queda marcada la foto en el catalogo.
 *
 * La frontera existe porque una foto de inmueble no es una foto cualquiera: el
 * comprador va a ir a esa casa. Lo que la foto enseña de mas, lo descubre de
 * pie en el andén.
 */
export enum RetouchKind {
  /**
   * Revelar: se cambia como se ve la MISMA escena, no la escena.
   *
   * Luz, contraste, balance de blancos, color, nitidez, ruido, enderezar.
   * Es lo que hacia un laboratorio con un negativo, y es lo que un comprador
   * espera de una foto profesional. Nadie se siente engañado porque la sala
   * estuviera bien expuesta.
   */
  REVELADO = 'REVELADO',

  /**
   * Falsear: se cambia LO QUE HAY.
   *
   * Cielo azul donde estaba nublado, calle sin cables, sala sin el sofa,
   * alcoba amoblada que esta vacia, jardin verde en verano. Cada una de estas
   * cosas es una promesa que el inmueble no puede cumplir el dia de la visita.
   *
   * No se prohibe —quien conoce el inmueble es el asesor, no este codigo— pero
   * exige que alguien lo confirme a mano y deja la foto marcada.
   */
  ALTERACION = 'ALTERACION',

  /**
   * Falsear tapando un defecto: humedad, moho, grietas, filtraciones, oxido.
   *
   * Se separa de `ALTERACION` porque no es lo mismo en derecho ni en decencia.
   * Un cielo azul de mas es publicidad exagerada; borrar la mancha de humedad
   * del techo de la alcoba es esconder un vicio del inmueble a quien lo va a
   * comprar. En Colombia eso deja de ser marketing: el Estatuto del Consumidor
   * (Ley 1480 de 2011) obliga a informacion veraz y suficiente, y el Codigo
   * Civil responsabiliza al vendedor por los vicios ocultos.
   *
   * Tampoco se bloquea, por la misma razon que lo anterior: puede que la
   * mancha ya se haya reparado y la foto sea vieja. Pero eso hay que decirlo,
   * no dejarlo implicito — y queda escrito quien lo dijo.
   */
  OCULTA_DEFECTO = 'OCULTA_DEFECTO',
}

/** Como se le enseña cada categoria a una persona. */
export const RETOUCH_KIND_LABEL: Record<RetouchKind, string> = {
  [RetouchKind.REVELADO]: 'Revelado',
  [RetouchKind.ALTERACION]: 'Altera la realidad',
  [RetouchKind.OCULTA_DEFECTO]: 'Oculta un defecto del inmueble',
};

/**
 * En que punto esta un retoque.
 *
 * `PENDIENTE` es el estado que da sentido a todo el modulo: la IA ya contesto y
 * ya se pago, pero la foto del anuncio NO ha cambiado. Un retoque que se
 * aplicara solo seria un anuncio modificado sin que nadie lo mirara, y el que
 * mira tiene que ser una persona que conoce el inmueble.
 */
export enum RetouchStatus {
  /** Hecho y pagado, esperando que un asesor lo vea y decida. */
  PENDIENTE = 'PENDIENTE',
  /** El asesor lo acepto: la foto del anuncio es ahora la retocada. */
  APLICADO = 'APLICADO',
  /** El asesor dijo que no. Los ficheros candidatos se borran. */
  DESCARTADO = 'DESCARTADO',
  /** Estuvo aplicado y se volvio al original. */
  REVERTIDO = 'REVERTIDO',
  /** No se llego a tener imagen: el proveedor fallo. No se cobra al catalogo. */
  FALLIDO = 'FALLIDO',
}
