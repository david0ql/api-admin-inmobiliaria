/**
 * Editar una imagen, no mirarla ni conversar.
 *
 * Tercera interfaz sobre el mismo proveedor, por la misma razon que
 * `VisionProvider` es distinta de `ChatProvider`: la forma de la conversacion
 * no se parece. Aqui no se habla `/chat/completions` sino `/images/edits`, el
 * cuerpo es `multipart/form-data` con el fichero dentro —no un data URI— y lo
 * que vuelve son bytes de imagen en base64, no texto que haya que parsear.
 *
 * Va aparte del analisis tambien por lo que cuesta. Analizar una foto son
 * decimas de centavo; editarla, entre 5 y 18 centavos. Mezclar las dos cosas en
 * una interfaz invitaria a llamar a la cara desde donde se llama a la barata.
 */

export interface ImageEditRequest {
  model: string;
  /** El fichero original, ya leido. Va como parte del multipart. */
  image: Buffer;
  /** `image/png`, `image/webp`... Decide el nombre con el que viaja. */
  mimeType: string;
  /** Encabezado documental mas lo que escribio el asesor, ya unido. */
  prompt: string;
  /**
   * Ancho y alto del resultado, `1584x1056`.
   *
   * Lo calcula quien llama porque el proveedor solo acepta lados multiplos de
   * 16, y el original casi nunca lo es: las fotos del catalogo son de 1600x1067.
   */
  size: string;
  /**
   * `low`, `medium`, `high` o `auto`.
   *
   * Aqui no es una palanca de gasto sino de fidelidad, y esta medido: con
   * `medium` el modelo invento una moldura en el techo de una sala real; con
   * `high` y el mismo encargo respeto una cocina entera, cubos de fregar
   * incluidos. Lo barato sale caro cuando lo que se abarata es la verdad.
   */
  quality: string;
  signal?: AbortSignal;
}

export interface ImageEditResponse {
  /** Los bytes de la imagen editada, ya decodificados de base64. */
  data: Buffer;
  /** `png`, `jpeg` o `webp`, tal y como lo devolvio el proveedor. */
  format: string;
  model: string;
  /**
   * Lo consumido, separando imagen de texto.
   *
   * Se separa porque el precio NO es el mismo: la imagen de entrada y la de
   * salida se cobran a tarifas distintas, y con un total agregado no se puede
   * calcular lo que costo la llamada. Es el unico dato con el que se le puede
   * enseñar al asesor un precio que sea verdad.
   */
  usage: {
    inputImageTokens: number;
    inputTextTokens: number;
    outputTokens: number;
  } | null;
}

export interface ImageEditProvider {
  editImage(request: ImageEditRequest): Promise<ImageEditResponse>;
}
