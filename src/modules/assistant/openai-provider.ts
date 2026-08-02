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
export class OpenAiProvider implements ChatProvider {
  private readonly logger = new Logger(OpenAiProvider.name);

  constructor(private readonly config: AppConfigService) {}

  get model(): string {
    return this.config.chat.model;
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
