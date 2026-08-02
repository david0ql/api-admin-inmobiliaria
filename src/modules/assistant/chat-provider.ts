/**
 * El proveedor del modelo, detras de una interfaz.
 *
 * El servicio del asistente no sabe si al otro lado hay OpenAI, Anthropic o un
 * modelo propio: solo pide "dame el siguiente paso" y recibe, o texto que
 * escupir al visitante, o una tanda de llamadas a herramientas que ejecutar.
 * Cambiar de proveedor es escribir otra clase que cumpla esto, no reescribir el
 * bucle del agente.
 */

/** Roles del hilo. `tool` transporta el resultado de una herramienta. */
export type ChatRole = 'system' | 'user' | 'assistant' | 'tool';

/** Una llamada a herramienta pedida por el modelo. */
export interface ToolCall {
  id: string;
  name: string;
  /** Argumentos como el modelo los emitio: JSON sin parsear todavia. */
  arguments: string;
}

/**
 * Un mensaje del hilo tal y como viaja hacia y desde el proveedor.
 *
 * Un mensaje del asistente puede no tener texto (`content` vacio) y traer solo
 * `toolCalls`; un mensaje `tool` lleva el resultado y referencia la llamada por
 * `toolCallId`.
 */
export interface ChatMessage {
  role: ChatRole;
  content: string;
  toolCalls?: ToolCall[];
  toolCallId?: string;
  /** Nombre de la herramienta, en los mensajes `tool`. Ayuda al modelo. */
  name?: string;
}

/** Declaracion de una herramienta que el modelo puede pedir. */
export interface ToolSpec {
  name: string;
  description: string;
  /** JSON Schema de los parametros. */
  parameters: Record<string, unknown>;
}

/** Lo que emite el proveedor mientras produce una respuesta. */
export type ChatEvent =
  /** Un fragmento de texto para el visitante. Se transmiten segun llegan. */
  | { type: 'text'; delta: string }
  /** El turno se cierra pidiendo ejecutar estas herramientas. */
  | { type: 'tool_calls'; calls: ToolCall[] }
  /** El turno se cierra con texto: no hay mas que hacer. */
  | { type: 'done' };

export interface ChatRequest {
  messages: ChatMessage[];
  tools: ToolSpec[];
  signal?: AbortSignal;
}

/**
 * Un paso de conversacion. Emite eventos segun el modelo produce: primero el
 * texto en fragmentos, y al final o bien `done` o bien `tool_calls`. El bucle
 * del agente decide que hacer con eso.
 */
export interface ChatProvider {
  readonly model: string;
  stream(request: ChatRequest): AsyncIterable<ChatEvent>;
}
