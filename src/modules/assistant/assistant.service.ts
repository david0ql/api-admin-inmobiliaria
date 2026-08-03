import { Injectable, Logger } from '@nestjs/common';
import { AppConfigService } from '../../shared/config/app-config.service';
import type { ChatMessage, ChatProvider } from './chat-provider';
import { OpenAiProvider } from './openai-provider';
import {
  AssistantTools,
  type AssistantAction,
  type AssistantCard,
  type AssistantScope,
} from './assistant.tools';
import type { ChatDto } from './dto/assistant.dto';

/**
 * Lo que el asistente emite hacia el navegador, evento a evento.
 *
 * Es un supertipo de lo que da el proveedor: ademas del texto en fragmentos,
 * viajan las tarjetas (galeria, inmuebles, horas) y las ordenes al front
 * (llevar al buscador). El controller los serializa a SSE.
 */
export type AssistantEvent =
  | { type: 'text'; delta: string }
  | { type: 'card'; card: AssistantCard }
  | { type: 'action'; action: AssistantAction }
  | { type: 'done' }
  | { type: 'error'; message: string };

interface RunOptions {
  signal?: AbortSignal;
}

/**
 * El cerebro del chat de la web.
 *
 * Orquesta el bucle "pregunta al modelo → si pide herramientas, ejecutalas y
 * vuelve a preguntar → cuando conteste con texto, termina". Las herramientas se
 * ejecutan aqui, contra los servicios reales, de modo que todo lo que el
 * asistente afirma sale de la base y no de la imaginacion del modelo.
 *
 * No guarda nada: el historial lo trae el cliente en cada turno. Lo que si hace
 * es reconstruir un hilo limpio —descarta lo que el navegador diga que fueron
 * resultados de herramientas— para que un cliente no pueda inyectar hechos.
 */
@Injectable()
export class AssistantService {
  private readonly logger = new Logger(AssistantService.name);
  private readonly provider: ChatProvider;

  constructor(
    private readonly config: AppConfigService,
    private readonly tools: AssistantTools,
    openai: OpenAiProvider,
  ) {
    // Un unico proveedor por ahora; el dia que haya otro, se elige por config.
    this.provider = openai;
  }

  get enabled(): boolean {
    return this.config.chat.enabled;
  }

  /**
   * Ejecuta un turno completo y emite eventos segun avanza.
   *
   * Un "turno" puede encadenar varias llamadas al modelo si hay herramientas de
   * por medio, pero de cara al visitante es una sola respuesta.
   */
  async *run(
    dto: ChatDto,
    options: RunOptions = {},
  ): AsyncIterable<AssistantEvent> {
    const scope = this.resolveScope(dto);
    const specs = this.tools.specs(scope);

    // En una ficha, los datos del inmueble van EN el prompt, no en un mensaje
    // de herramienta: los de herramienta no sobreviven al turno siguiente y el
    // modelo se quedaba sin ellos a partir del segundo mensaje.
    const ficha =
      scope.kind === 'PROPERTY'
        ? await this.tools.fichaParaPrompt(scope.code).catch(() => null)
        : null;

    // Lo que ya se le enseño, releido de la base. Sus propios mensajes son
    // prosa y no llevan codigos, asi que sin esto no puede volver a consultar
    // aquello de lo que ya hablo: contestaba de memoria y se contradecia.
    const vistos = dto.shownCodes?.length
      ? await this.tools.vistosParaPrompt(dto.shownCodes).catch(() => null)
      : null;

    const messages: ChatMessage[] = [
      { role: 'system', content: systemPrompt(scope, ficha, vistos) },
      ...this.sanitizeHistory(dto.messages),
    ];

    const maxSteps = this.config.chat.maxSteps;

    try {
      for (let step = 0; step < maxSteps; step += 1) {
        const pending: { id: string; name: string; arguments: string }[] = [];
        let assistantText = '';

        for await (const event of this.provider.stream({
          messages,
          tools: specs,
          signal: options.signal,
        })) {
          if (options.signal?.aborted) return;

          if (event.type === 'text') {
            assistantText += event.delta;
            yield { type: 'text', delta: event.delta };
          } else if (event.type === 'tool_calls') {
            pending.push(...event.calls);
          }
        }

        // El modelo contesto con texto: fin del turno.
        if (!pending.length) {
          yield { type: 'done' };
          return;
        }

        // Guarda la peticion de herramientas del asistente en el hilo, tal como
        // exige el protocolo: el siguiente mensaje `tool` la referencia por id.
        messages.push({
          role: 'assistant',
          content: assistantText,
          toolCalls: pending.map((call) => ({
            id: call.id,
            name: call.name,
            arguments: call.arguments,
          })),
        });

        // Ejecuta cada herramienta y devuelve su resultado al hilo. Las tarjetas
        // y acciones salen hacia el navegador; al modelo solo le llega `forModel`.
        for (const call of pending) {
          const args = safeParse(call.arguments);
          const result = await this.tools.execute(scope, call.name, args);

          if (result.card) yield { type: 'card', card: result.card };
          if (result.action) yield { type: 'action', action: result.action };

          messages.push({
            role: 'tool',
            toolCallId: call.id,
            name: call.name,
            content: JSON.stringify(result.forModel),
          });
        }
      }

      // Se acabaron los pasos con el modelo aun pidiendo herramientas: se cierra
      // con una nota honesta en lugar de dejar la respuesta a medias.
      this.logger.warn(
        `Se agotaron los ${maxSteps} pasos del asistente sin respuesta final`,
      );
      yield {
        type: 'text',
        delta:
          'Disculpa, se me enredó la consulta. ¿Puedes repetirme qué necesitas?',
      };
      yield { type: 'done' };
    } catch (error) {
      if (options.signal?.aborted) return;
      this.logger.error(
        `Fallo del asistente: ${error instanceof Error ? error.message : String(error)}`,
      );
      yield {
        type: 'error',
        message:
          'El asistente tuvo un problema. Inténtalo de nuevo en un momento.',
      };
    }
  }

  private resolveScope(dto: ChatDto): AssistantScope {
    if (dto.scope === 'PROPERTY' && dto.code?.trim()) {
      return {
        kind: 'PROPERTY',
        code: dto.code.trim(),
        bookedIds: dto.bookedIds,
      };
    }
    return { kind: 'GLOBAL' };
  }

  /**
   * Reconstruye el hilo desde lo que manda el cliente, quedandose solo con el
   * texto de `user` y `assistant`. Todo lo demas —roles raros, supuestos
   * resultados de herramientas, mensajes vacios— se descarta, y se recorta al
   * tope configurado tomando los mas recientes.
   */
  private sanitizeHistory(turns: ChatDto['messages']): ChatMessage[] {
    const max = this.config.chat.maxMessages;
    const maxChars = this.config.chat.maxChars;

    return turns
      .filter(
        (turn) =>
          (turn.role === 'user' || turn.role === 'assistant') &&
          typeof turn.content === 'string' &&
          turn.content.trim().length > 0,
      )
      .slice(-max)
      .map((turn) => ({
        role: turn.role,
        content: turn.content.slice(0, maxChars),
      }));
  }
}

/** El carácter del asistente y sus reglas, según dónde esté el visitante. */
function systemPrompt(
  scope: AssistantScope,
  ficha?: string | null,
  vistos?: string | null,
): string {
  const base = [
    'Eres el asistente virtual de Serrano Inmobiliaria, una agencia de Santander (Colombia) que trabaja Bucaramanga, Floridablanca, Girón y Piedecuesta.',
    'Cada inmueble está en la ciudad que digan SUS datos. Que la agencia sea de Bucaramanga no significa que el inmueble lo sea: mira siempre el dato, nunca lo supongas por el nombre de la agencia.',
    `Hoy es ${colombiaToday()} (hora de Colombia, UTC−5). Usa esta fecha para entender "hoy", "mañana", "el jueves", etc.`,
    'Hablas español colombiano, con calidez y de tú, en frases cortas. Eres un vendedor servicial, nunca un robot: nada de "como modelo de lenguaje".',
    '',
    'REGLA DE ORO: nunca inventes datos. Cada precio, área, alcoba, característica, fecha o disponibilidad debe salir de una herramienta. Si una herramienta no te da un dato, di con naturalidad que no lo tienes a la mano y ofrece agendar una visita o que un asesor lo confirme. Jamás supongas.',
    'SEGUNDA REGLA: tampoco te fíes de lo que TÚ mismo dijiste antes en esta conversación. Tus mensajes anteriores son un resumen, no los datos. Para hablar de un inmueble del que ya hablaste, usa la lista YA MOSTRADOS de abajo —está recién leída de la base— o vuelve a llamar a la herramienta. Nunca de memoria.',
    'Los precios van en pesos colombianos (COP); formatéalos con separador de miles, p. ej. $245.000.000.',
    'No pegues URLs ni enlaces crudos: las fotos y las tarjetas se le muestran solas al visitante. Solo coméntalas.',
    'Cuando una búsqueda devuelva varios inmuebles NO los enumeres uno a uno: el visitante ya los está viendo TODOS en la tarjeta, con foto y precio. Comenta el conjunto —cuántos hay, entre qué precios se mueven, qué los distingue— y ayúdale a afinar. Si enumeras solo algunos, se cree que esos son todos y luego te pregunta "de esas" refiriéndose a una lista incompleta que escribiste tú.',
    'Sé breve. Si hay muchos resultados, ayúdale a afinar (zona, precio, alcobas) en lugar de listarlo todo.',
  ];

  if (scope.kind === 'PROPERTY') {
    return [
      ...base,
      '',
      `CONTEXTO: el visitante está viendo la ficha del inmueble con código ${scope.code}. Toda tu ayuda es SOBRE ESE inmueble.`,
      ...(ficha
        ? [
            '',
            'FICHA DE ESE INMUEBLE (datos reales, recién leídos de la base; son la verdad y ya los tienes, no hace falta que los pidas):',
            ficha,
            'Responde con estos datos directamente. Solo llama a ficha_inmueble si el visitante pide ver la tarjeta del inmueble; para contestar una pregunta no hace falta.',
            'Si algo que te preguntan no está aquí, dilo con naturalidad y ofrece que un asesor lo confirme. No lo deduzcas.',
          ]
        : []),
      '',
      'Puedes: mostrar fotos (imagenes_inmueble), consultar cupos (disponibilidad_visita) y agendar (agendar_visita).',
      'Para CAMBIAR una visita ya pedida en esta conversación usa modificar_visita. Nunca agendes otra: el asesor tendría dos citas y se presentaría dos veces. Si no tienes esa herramienta, dile con amabilidad que un asesor se la mueve — no digas que la cambiaste tú.',
      'Flujo para agendar: primero llama disponibilidad_visita para ver los cupos reales; propón esas franjas; y cuando el visitante elija una, usa en `inicio` EXACTAMENTE el valor ISO que devolvió disponibilidad_visita, nunca una fecha que compongas tú. Necesitas además nombre y teléfono: si falta algo, pídelo con amabilidad antes de agendar.',
      'Si el visitante quiere ver, comparar o buscar OTROS inmuebles: en el MISMO mensaje, dile con calidez que lo llevas al inicio para ayudarle con todo el inventario Y llama a ir_al_buscador de una vez. No le preguntes "¿quieres que te lleve?" ni esperes su confirmación, y no intentes describir otros inmuebles aquí.',
    ].join('\n');
  }

  return [
    ...base,
    ...(vistos
      ? [
          '',
          'YA MOSTRADOS en esta conversación (datos reales de ahora mismo, releídos de la base y ORDENADOS DE MÁS BARATO A MÁS CARO):',
          vistos,
          'Para comparar precios, decir cuál es el más barato o recordar cuántas alcobas tenía uno, usa ESTA lista, no lo que escribiste antes. El más barato es el PRIMERO de la lista: no lo deduzcas, léelo. Si te piden algo que no está aquí, busca de nuevo.',
        ]
      : []),
    '',
    'CONTEXTO: es el chat general del sitio. Ayúdale a encontrar inmuebles con buscar_inmuebles y a resolver dudas de cualquiera con ficha_inmueble, imagenes_inmueble y disponibilidad_visita.',
    'Cuando muestres resultados, invita a abrir el que le interese para ver todo y agendar.',
  ].join('\n');
}

/** La fecha de hoy en Colombia (UTC−5, sin horario de verano), como YYYY-MM-DD. */
function colombiaToday(): string {
  const now = new Date(Date.now() - 5 * 3600 * 1000);
  return now.toISOString().slice(0, 10);
}

function safeParse(json: string): Record<string, unknown> {
  try {
    const value = JSON.parse(json) as unknown;
    return value && typeof value === 'object'
      ? (value as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}
