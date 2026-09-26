import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

/**
 * Cifrado de las credenciales de los portales.
 *
 * AES-256-GCM: ademas de ocultar, autentica. Una fila manipulada en base —o
 * descifrada con otra clave— falla al leer en lugar de devolver basura que
 * acabaria enviada a un portal como si fuera una API key.
 *
 * Formato: `v1.<iv>.<tag>.<cifrado>`, todo en base64url. El prefijo de version
 * deja cambiar de algoritmo sin tener que adivinar como se guardo cada fila.
 */
const VERSION = 'v1';

export function encryptSecrets(
  key: Buffer,
  values: Record<string, string>,
): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const data = Buffer.concat([
    cipher.update(JSON.stringify(values), 'utf8'),
    cipher.final(),
  ]);
  return [
    VERSION,
    iv.toString('base64url'),
    cipher.getAuthTag().toString('base64url'),
    data.toString('base64url'),
  ].join('.');
}

export function decryptSecrets(
  key: Buffer,
  payload: string,
): Record<string, string> {
  const [version, iv, tag, data] = payload.split('.');
  if (version !== VERSION || !iv || !tag || !data) {
    throw new Error('Formato de credenciales desconocido');
  }
  const decipher = createDecipheriv(
    'aes-256-gcm',
    key,
    Buffer.from(iv, 'base64url'),
  );
  decipher.setAuthTag(Buffer.from(tag, 'base64url'));
  const plain = Buffer.concat([
    decipher.update(Buffer.from(data, 'base64url')),
    decipher.final(),
  ]).toString('utf8');
  return JSON.parse(plain) as Record<string, string>;
}
