import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { AppConfigService } from '../../shared/config/app-config.service';

const VERIFY_URL: Record<string, string> = {
  turnstile: 'https://challenges.cloudflare.com/turnstile/v0/siteverify',
  recaptcha: 'https://www.google.com/recaptcha/api/siteverify',
};

/**
 * Verificacion del captcha de los formularios publicos.
 *
 * Admite Turnstile y reCAPTCHA porque ambos hablan el mismo protocolo:
 * `POST secret + response`, respuesta con `success`. Si no hay secreto
 * configurado la verificacion se salta y se deja constancia en el log — util
 * en desarrollo, y visible en produccion para que nadie descubra por sorpresa
 * que el formulario lleva meses abierto de par en par.
 */
@Injectable()
export class CaptchaService {
  private readonly logger = new Logger(CaptchaService.name);
  private warned = false;

  constructor(private readonly config: AppConfigService) {}

  async verify(token: string | undefined, ip?: string): Promise<void> {
    const secret = this.config.captcha.secret;

    if (!secret) {
      if (!this.warned) {
        this.logger.warn(
          'CAPTCHA_SECRET sin configurar: los formularios publicos aceptan envios sin verificar.',
        );
        this.warned = true;
      }
      return;
    }

    if (!token)
      throw new BadRequestException('Falta la verificacion del captcha');

    const url = VERIFY_URL[this.config.captcha.provider];
    const body = new URLSearchParams({ secret, response: token });
    if (ip) body.set('remoteip', ip);

    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body,
        signal: AbortSignal.timeout(8000),
      });
      const data = (await res.json()) as { success?: boolean };
      if (!data.success) {
        throw new BadRequestException(
          'La verificacion del captcha no paso. Intentalo de nuevo.',
        );
      }
    } catch (error) {
      if (error instanceof BadRequestException) throw error;
      // Si el proveedor no responde no se puede afirmar que el envio sea
      // legitimo, pero tampoco se castiga a un usuario real: se registra y se
      // deja pasar, que es lo que hace fallar del lado seguro para el negocio.
      this.logger.error(
        `No se pudo verificar el captcha: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}
