import {
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { AppConfigService } from '../../shared/config/app-config.service';
import type {
  ChatEvent,
  ChatMessage,
  ChatProvider,
  ChatRequest,
  ToolCall,
} from './chat-provider';
import type {
  VisionProvider,
  VisionRequest,
  VisionResponse,
} from './vision-provider';
import type {
  ImageEditProvider,
  ImageEditRequest,
  ImageEditResponse,
} from './image-edit-provider';

/**
 * Proveedor OpenAI sobre `fetch`.
 *
 * Se habla el protocolo `/chat/completions` a pelo, sin el SDK: es una sola
 * llamada con `stream: true` y un parseo de SSE, y asi el asistente no arrastra
 * una dependencia mas ni queda atado a la forma del cliente oficial. El mismo
 * patron que ya usa `CaptchaService` para hablar con Cloudflare.
 *
 * Compatible con cualquier API que hable el dialecto de OpenAI (Azure OpenAI,
 * puertas locales): solo cambia `CHAT_BASE_URL`.
 */
@Injectable()
export class OpenAiProvider
  implements ChatProvider, VisionProvider, ImageEditProvider
{
  private readonly logger = new Logger(OpenAiProvider.name);

  constructor(private readonly config: AppConfigService) {}

  get model(): string {
    return this.config.chat.model;
  }

  /**
   * Una pregunta con imagenes dentro y una respuesta en JSON.
   *
   * Sin `stream`: lo que vuelve es un objeto que hay que validar entero antes
   * de guardarlo, asi que no hay nada que ir enseñando por el camino.
   *
   * Las imagenes viajan como `data:` URI en el propio cuerpo y NUNCA como una
   * URL de `/media/...`: eso obligaria a que el inmueble estuviera publicado y
   * a que el proveedor pudiera entrar a nuestro servidor, y las fotos de una
   * solicitud de consignacion no estan publicadas ni deben estarlo.
   *
   * `temperature` a 0: aqui no se quiere variedad. Dos analisis de la misma
   * foto con el mismo prompt tienen que parecerse, o comparar versiones del
   * prompt no mide el prompt, mide el ruido.
   */
  async seeJson(request: VisionRequest): Promise<VisionResponse> {
    const { apiKey, baseUrl } = this.config.chat;
    if (!apiKey) {
      throw new ServiceUnavailableException(
        'El analisis de imagenes no esta configurado: falta la clave del proveedor',
      );
    }
    const model = request.model || this.config.chat.model;

    const body = {
      model,
      temperature: 0,
      max_tokens: request.maxOutputTokens ?? 4_000,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: request.system },
        {
          role: 'user',
          content: [
            { type: 'text', text: request.user },
            ...request.images.map((image) => ({
              type: 'image_url',
              image_url: {
                url: `data:${image.mimeType};base64,${image.data.toString('base64')}`,
                detail: image.detail ?? 'low',
              },
            })),
          ],
        },
      ],
    };

    let res: Response;
    try {
      res = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
        signal: request.signal,
      });
    } catch (error) {
      this.logger.error(
        `No se pudo contactar al proveedor: ${errorMessage(error)}`,
      );
      throw new ServiceUnavailableException(
        'El analisis de imagenes no esta disponible ahora mismo',
      );
    }

    if (!res.ok) {
      // Del detalle solo se registra el principio, y NUNCA el cuerpo enviado:
      // ahi van las imagenes en base64 y, mas importante, la cabecera lleva la
      // clave. Un log con la clave dentro es la clave publicada.
      const detail = await res.text().catch(() => '');
      this.logger.error(
        `Proveedor respondio ${res.status}: ${detail.slice(0, 500)}`,
      );
      throw new ServiceUnavailableException(
        'El analisis de imagenes no esta disponible ahora mismo',
      );
    }

    const json = (await res.json()) as OpenAiCompletion;
    return {
      content: json.choices?.[0]?.message?.content ?? '',
      model: json.model ?? model,
      usage: json.usage
        ? {
            inputTokens: json.usage.prompt_tokens ?? 0,
            outputTokens: json.usage.completion_tokens ?? 0,
          }
        : null,
    };
  }

  /**
   * Edita una imagen y devuelve otra.
   *
   * `/images/edits` y no `/chat/completions`: es el unico endpoint que acepta
   * una foto y devuelve pixeles. El cuerpo va en `multipart/form-data` con
   * `FormData` y `Blob` nativos —Node 20 los trae— para no añadir `form-data`
   * ni el SDK por una sola llamada, que es la misma decision que ya se tomo
   * para el resto de este fichero.
   *
   * El campo se llama `image[]` y no `image`: el endpoint acepta varias
   * referencias y con el nombre en singular contesta 400.
   *
   * Sin `signal` propio ni tiempo de espera corto: una edicion real tarda entre
   * 30 y 60 segundos —medido, 34 s en calidad media y mas en alta— y cortarla
   * antes de tiempo es pagar la llamada y tirar el resultado. Quien llama pone
   * el limite si lo quiere.
   */
  async editImage(request: ImageEditRequest): Promise<ImageEditResponse> {
    const { apiKey, baseUrl } = this.config.chat;
    if (!apiKey) {
      throw new ServiceUnavailableException(
        'El retoque de imagenes no esta configurado: falta la clave del proveedor',
      );
    }

    const form = new FormData();
    form.append('model', request.model);
    form.append(
      'image[]',
      new Blob([new Uint8Array(request.image)], { type: request.mimeType }),
      `original.${extensionDe(request.mimeType)}`,
    );
    form.append('prompt', request.prompt);
    form.append('size', request.size);
    form.append('quality', request.quality);
    // PNG y no WebP: es sin perdida, y esta imagen todavia tiene por delante el
    // reencodeo de `StorageService` a los cuatro tamaños. Comprimir con perdida
    // dos veces seguidas se nota justo en lo que se acaba de pagar por mejorar.
    form.append('output_format', 'png');

    let res: Response;
    try {
      res = await fetch(`${baseUrl}/images/edits`, {
        method: 'POST',
        // Sin `Content-Type` a mano: lo pone `FormData` con su `boundary`, y
        // escribirlo aqui lo rompe.
        headers: { Authorization: `Bearer ${apiKey}` },
        body: form,
        signal: request.signal,
      });
    } catch (error) {
      this.logger.error(
        `No se pudo contactar al proveedor: ${errorMessage(error)}`,
      );
      throw new ServiceUnavailableException(
        'El retoque de imagenes no esta disponible ahora mismo',
      );
    }

    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      this.logger.error(
        `Proveedor respondio ${res.status} al editar: ${detail.slice(0, 500)}`,
      );
      // El motivo del rechazo si sube: a diferencia del analisis, aqui el 400
      // suele ser culpa de lo que escribio el asesor —una peticion que el
      // proveedor no acepta— y sin decirselo volveria a pulsar igual.
      throw new ServiceUnavailableException(
        res.status === 400
          ? 'El proveedor rechazo la peticion de retoque. Revisa la instruccion.'
          : 'El retoque de imagenes no esta disponible ahora mismo',
      );
    }

    const json = (await res.json()) as OpenAiImageEdit;
    const b64 = json.data?.[0]?.b64_json;
    if (!b64) {
      this.logger.error('El proveedor no devolvio imagen');
      throw new ServiceUnavailableException(
        'El proveedor no devolvio ninguna imagen',
      );
    }

    const detalleEntrada = json.usage?.input_tokens_details;
    return {
      data: Buffer.from(b64, 'base64'),
      format: json.output_format ?? 'png',
      model: request.model,
      usage: json.usage
        ? {
            inputImageTokens: detalleEntrada?.image_tokens ?? 0,
            inputTextTokens: detalleEntrada?.text_tokens ?? 0,
            outputTokens: json.usage.output_tokens ?? 0,
          }
        : null,
    };
  }

  async *stream(request: ChatRequest): AsyncIterable<ChatEvent> {
    const { apiKey, baseUrl, model } = this.config.chat;
    if (!apiKey) {
      // No deberia llegar aqui: el controller ya corta con 503 si no hay chat.
      throw new ServiceUnavailableException('El asistente no esta configurado');
    }

    const body = {
      model,
      stream: true,
      // El chat de una web va bajo, no divaga: temperatura contenida.
      temperature: 0.3,
      messages: request.messages.map(toWireMessage),
      tools: request.tools.map((tool) => ({
        type: 'function',
        function: {
          name: tool.name,
          description: tool.description,
          parameters: tool.parameters,
        },
      })),
      tool_choice: 'auto',
      parallel_tool_calls: true,
    };

    let res: Response;
    try {
      res = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
        signal: request.signal,
      });
    } catch (error) {
      if (isAbort(error)) return;
      this.logger.error(
        `No se pudo contactar al proveedor: ${errorMessage(error)}`,
      );
      throw new ServiceUnavailableException(
        'El asistente no esta disponible ahora mismo',
      );
    }

    if (!res.ok || !res.body) {
      const detail = await res.text().catch(() => '');
      this.logger.error(
        `Proveedor respondio ${res.status}: ${detail.slice(0, 500)}`,
      );
      throw new ServiceUnavailableException(
        'El asistente no esta disponible ahora mismo',
      );
    }

    // Las llamadas a herramientas llegan troceadas entre varios `delta`: se
    // acumulan por indice y se emiten enteras al cerrar el turno.
    const toolAcc = new Map<
      number,
      { id: string; name: string; args: string }
    >();
    let sawToolCall = false;

    try {
      for await (const data of parseSse(res.body, request.signal)) {
        if (data === '[DONE]') break;

        let chunk: OpenAiStreamChunk;
        try {
          chunk = JSON.parse(data) as OpenAiStreamChunk;
        } catch {
          continue; // fragmento partido o comentario keep-alive: se ignora
        }

        const choice = chunk.choices?.[0];
        if (!choice) continue;
        const delta = choice.delta;

        if (delta?.content) {
          yield { type: 'text', delta: delta.content };
        }

        for (const call of delta?.tool_calls ?? []) {
          sawToolCall = true;
          const slot = toolAcc.get(call.index) ?? {
            id: '',
            name: '',
            args: '',
          };
          if (call.id) slot.id = call.id;
          if (call.function?.name) slot.name += call.function.name;
          if (call.function?.arguments) slot.args += call.function.arguments;
          toolAcc.set(call.index, slot);
        }

        if (
          choice.finish_reason === 'tool_calls' ||
          (choice.finish_reason && sawToolCall)
        ) {
          break;
        }
      }
    } catch (error) {
      if (isAbort(error)) return;
      throw error;
    }

    if (sawToolCall) {
      const calls: ToolCall[] = [...toolAcc.entries()]
        .sort(([a], [b]) => a - b)
        .map(([, slot]) => ({
          id: slot.id,
          name: slot.name,
          arguments: slot.args || '{}',
        }))
        .filter((call) => call.name);
      if (calls.length) {
        yield { type: 'tool_calls', calls };
        return;
      }
    }

    yield { type: 'done' };
  }
}

// --- forma de red ---------------------------------------------------------

interface WireMessage {
  role: string;
  content: string | null;
  tool_calls?: {
    id: string;
    type: 'function';
    function: { name: string; arguments: string };
  }[];
  tool_call_id?: string;
  name?: string;
}

function toWireMessage(message: ChatMessage): WireMessage {
  const wire: WireMessage = {
    role: message.role,
    content: message.content || (message.toolCalls?.length ? null : ''),
  };
  if (message.toolCalls?.length) {
    wire.tool_calls = message.toolCalls.map((call) => ({
      id: call.id,
      type: 'function',
      function: { name: call.name, arguments: call.arguments },
    }));
  }
  if (message.role === 'tool') {
    wire.tool_call_id = message.toolCallId;
    wire.name = message.name;
  }
  return wire;
}

/** Respuesta sin `stream`, que es la que usa `seeJson`. */
interface OpenAiCompletion {
  model?: string;
  choices?: { message?: { content?: string | null } }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}

/** Respuesta de `/images/edits`. */
interface OpenAiImageEdit {
  output_format?: string;
  data?: { b64_json?: string }[];
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    input_tokens_details?: { image_tokens?: number; text_tokens?: number };
  };
}

/**
 * Extension a partir del tipo MIME, solo para dar nombre al fichero del
 * multipart. El proveedor mira los bytes, pero rechaza un nombre sin extension.
 */
function extensionDe(mimeType: string): string {
  const sub = mimeType.split('/')[1] ?? 'png';
  return sub === 'jpeg' ? 'jpg' : sub;
}

interface OpenAiStreamChunk {
  choices?: {
    delta?: {
      content?: string | null;
      tool_calls?: {
        index: number;
        id?: string;
        function?: { name?: string; arguments?: string };
      }[];
    };
    finish_reason?: string | null;
  }[];
}

/**
 * Trocea un cuerpo `text/event-stream` en los payloads de cada `data:`.
 *
 * El troceo de red no respeta las lineas del protocolo: un `data:` puede llegar
 * partido en dos chunks, o venir varios pegados. Se acumula en un buffer y se
 * cortan eventos por la linea en blanco, que es lo que SSE usa de separador.
 */
async function* parseSse(
  body: ReadableStream<Uint8Array>,
  signal?: AbortSignal,
): AsyncIterable<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (true) {
      if (signal?.aborted) return;
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let sep: number;
      // Un evento SSE termina en linea en blanco (\n\n, o \r\n\r\n).
      while ((sep = indexOfDoubleNewline(buffer)) !== -1) {
        const raw = buffer.slice(0, sep);
        buffer = buffer.slice(sep).replace(/^(\r?\n){1,2}/, '');
        const payload = raw
          .split(/\r?\n/)
          .filter((line) => line.startsWith('data:'))
          .map((line) => line.slice(5).trimStart())
          .join('\n');
        if (payload) yield payload;
      }
    }
  } finally {
    reader.releaseLock();
  }
}

function indexOfDoubleNewline(text: string): number {
  const lf = text.indexOf('\n\n');
  const crlf = text.indexOf('\r\n\r\n');
  if (lf === -1) return crlf;
  if (crlf === -1) return lf;
  return Math.min(lf, crlf);
}

function isAbort(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
