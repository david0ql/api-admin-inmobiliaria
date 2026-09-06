/**
 * Mirar imagenes, no conversar.
 *
 * El asistente de la web es un bucle de herramientas que va escupiendo texto
 * segun lo produce; el analisis de fotos es lo contrario: una sola pregunta con
 * varias imagenes dentro y una respuesta entera en JSON que hay que validar
 * antes de guardar. No tiene sentido transmitir por trozos algo que no se puede
 * usar hasta tenerlo completo.
 *
 * Por eso es otra interfaz y no otro cliente: la implementa la MISMA clase
 * (`OpenAiProvider`), con la misma clave, la misma URL base y el mismo trato de
 * errores. Un segundo cliente HTTP hacia el mismo proveedor seria un segundo
 * sitio donde equivocarse con la cabecera de autorizacion.
 */

/** Una imagen, ya leida y en memoria, lista para ir en la pregunta. */
export interface VisionImage {
  /** `image/webp`, `image/jpeg`... Va dentro del data URI. */
  mimeType: string;
  data: Buffer;
  /**
   * Cuanto detalle se le pide al modelo. `low` cuesta una fraccion y basta
   * para decir si algo es una cocina; `high` hace falta para leer una placa.
   */
  detail?: 'low' | 'high' | 'auto';
}

export interface VisionRequest {
  /**
   * Que modelo mirar con. Va por peticion y no por proveedor porque el analisis
   * de fotos y el chat de la web usan la misma clave y el mismo cliente, pero no
   * tienen por que usar el mismo modelo: uno necesita ver imagenes y el otro,
   * herramientas y latencia baja. Sin esto, mejorar el de las fotos obligaria a
   * mover tambien el del chat.
   */
  model?: string;
  /** Las instrucciones. Salen de la version activa del prompt editable. */
  system: string;
  /** El contexto del lote: que inmueble es y que midio la puerta de codigo. */
  user: string;
  images: VisionImage[];
  /** Techo de la respuesta. Acota el gasto de una llamada que se desmande. */
  maxOutputTokens?: number;
  signal?: AbortSignal;
}

export interface VisionResponse {
  /** El cuerpo tal cual lo devolvio el modelo; se valida fuera. */
  content: string;
  model: string;
  /** Lo que se consumio, para poder mirar el gasto sin ir a la factura. */
  usage: { inputTokens: number; outputTokens: number } | null;
}

export interface VisionProvider {
  readonly model: string;
  /** Una pregunta, una respuesta. Exige JSON al proveedor. */
  seeJson(request: VisionRequest): Promise<VisionResponse>;
}
