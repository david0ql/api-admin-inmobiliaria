import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { QueryFailedError } from 'typeorm';

type PgError = { code?: string; detail?: string; constraint?: string };

/**
 * Traduce cualquier excepcion a un cuerpo de error uniforme. En particular
 * convierte los errores de Postgres en codigos HTTP con sentido, para que un
 * duplicado no se presente al cliente como un 500 opaco.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('Http');

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<Request>();

    let status: number = HttpStatus.INTERNAL_SERVER_ERROR;
    let message: string | string[] = 'Error interno del servidor';
    let error = 'InternalServerError';

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const body = exception.getResponse();
      if (typeof body === 'string') {
        message = body;
      } else {
        const b = body as { message?: string | string[]; error?: string };
        message = b.message ?? exception.message;
        error = b.error ?? exception.name;
      }
      if (error === 'InternalServerError') error = exception.name;
    } else if (exception instanceof QueryFailedError) {
      const pg = exception.driverError as PgError;
      switch (pg?.code) {
        case '23505': // unique_violation
          status = HttpStatus.CONFLICT;
          error = 'Conflict';
          message = `Ya existe un registro con esos valores${pg.constraint ? ` (${pg.constraint})` : ''}`;
          break;
        case '23503': // foreign_key_violation
          status = HttpStatus.BAD_REQUEST;
          error = 'BadRequest';
          message =
            'Referencia inexistente: alguno de los identificadores enviados no existe';
          break;
        case '23502': // not_null_violation
          status = HttpStatus.BAD_REQUEST;
          error = 'BadRequest';
          message = 'Falta un campo obligatorio';
          break;
        case '22P02': // invalid_text_representation
          status = HttpStatus.BAD_REQUEST;
          error = 'BadRequest';
          message = 'Formato de identificador invalido';
          break;
        default:
          this.logger.error(
            `${pg?.code ?? 'sin codigo'}: ${exception.message}`,
            exception.stack,
          );
      }
    } else if (exception instanceof Error) {
      this.logger.error(exception.message, exception.stack);
    } else {
      this.logger.error(`Excepcion no serializable: ${String(exception)}`);
    }

    if (status >= 500) {
      this.logger.error(`${req.method} ${req.url} -> ${status}`);
    }

    res.status(status).json({
      statusCode: status,
      error,
      message,
      path: req.url,
      timestamp: new Date().toISOString(),
    });
  }
}
