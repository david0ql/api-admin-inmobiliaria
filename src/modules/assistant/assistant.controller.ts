import {
  Body,
  Controller,
  Post,
  Req,
  Res,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { Public } from '../iam/decorators';
import { AllowPendingPassword } from '../iam/guards/must-change-password.guard';
import { AssistantService, type AssistantEvent } from './assistant.service';
import { ConversationsService } from './conversations.service';
import { ChatDto, IdentifyDto } from './dto/assistant.dto';
import { texto } from './assistant.texts';

/** La IP real del visitante. `trust proxy` ya deja `req.ip` correcto. */
function ip(req: Request): string | undefined {
  return req.ip;
}

/**
 * El chat de la web publica.
 *
 * `@Public()` porque lo usa cualquier visitante sin sesion; el limite de
 * trafico es la unica puerta y va apretado —cada mensaje cuesta una llamada al
 * modelo—. La respuesta se transmite como `text/event-stream`: los fragmentos
 * de texto llegan segun el modelo los produce, y con ellos las tarjetas y las
 * ordenes para el navegador.
 */
@ApiTags('assistant')
@Public()
@AllowPendingPassword()
@Controller('public/assistant')
export class AssistantController {
  constructor(
    private readonly assistant: AssistantService,
    private readonly conversations: ConversationsService,
  ) {}

  @Post('identify')
  // Crea un cliente en la cartera: se limita mas que el chat.
  @Throttle({ default: { limit: 5, ttl: 300_000 } })
  @ApiOperation({
    summary: 'Identifica al visitante y abre su conversacion',
    description:
      'Busca por telefono y correo. Si ya existe reutiliza su ficha; si no, la crea.',
  })
  async identify(@Body() dto: IdentifyDto, @Req() req: Request) {
    return this.conversations.identify(dto, ip(req));
  }

  @Post('chat')
  // 20 turnos por minuto y por IP: da para una conversacion fluida y corta el
  // abuso, que aqui se paga en fichas del modelo.
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @ApiOperation({
    summary: 'Conversa con el asistente (respuesta en streaming SSE)',
    description:
      'Envia el historial y el ámbito (GLOBAL o PROPERTY). Responde un flujo de ' +
      'eventos SSE: `text` (fragmentos), `card` (galería/inmuebles/horas), ' +
      '`action` (p. ej. ir al buscador), `done` y `error`.',
  })
  async chat(
    @Body() dto: ChatDto,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    if (!this.assistant.enabled) {
      throw new ServiceUnavailableException(texto('apagado', dto.locale));
    }

    res.set({
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      // Sin esto, nginx bufferiza el stream y el efecto "va escribiendo" se
      // pierde: llega todo de golpe al final.
      'X-Accel-Buffering': 'no',
    });
    res.flushHeaders?.();

    // Si el visitante cierra el chat, se aborta la generacion: no se sigue
    // gastando modelo por una respuesta que ya nadie va a leer.
    const controller = new AbortController();
    req.on('close', () => controller.abort());

    try {
      for await (const event of this.assistant.run(dto, {
        signal: controller.signal,
      })) {
        write(res, event);
        if (event.type === 'done' || event.type === 'error') break;
      }
    } catch {
      if (!controller.signal.aborted) {
        write(res, {
          type: 'error',
          message: texto('fallo', dto.locale),
        });
      }
    } finally {
      res.end();
    }
  }
}

/** Un evento por bloque SSE: `event:` nombra el tipo, `data:` lleva el JSON. */
function write(res: Response, event: AssistantEvent): void {
  res.write(`event: ${event.type}\n`);
  res.write(`data: ${JSON.stringify(event)}\n\n`);
}
