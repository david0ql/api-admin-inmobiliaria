import { NotFoundException, StreamableFile } from '@nestjs/common';
import { createReadStream } from 'node:fs';
import type { Response } from 'express';
import type { StorageService } from '../media/storage.service';
import type { ConsignmentRequest } from './domain/consignment-request.entity';

/**
 * Entrega un documento de una solicitud.
 *
 * Se pide por POSICION dentro de la lista de documentos, no por su clave de
 * almacenamiento. Una clave en la URL es una credencial de facto: quien la
 * copia se lleva el fichero para siempre, y acaba en el historial y en los
 * logs. Con un indice, la URL no vale nada sin la sesion que la acompana.
 *
 * Quien puede llamar aqui lo decide cada controlador — un asesor en el panel,
 * el propietario en su portal—, y el chequeo de pertenencia es suyo. Esto solo
 * pone los bytes.
 */
export function streamConsignmentDocument(
  storage: StorageService,
  request: ConsignmentRequest,
  index: number,
  res: Response,
): StreamableFile {
  const documents = request.files.filter((file) => file.kind === 'DOCUMENT');
  const file = documents[index];
  if (!file) throw new NotFoundException('Documento no encontrado');

  const path = storage.privatePath(file.storageKey);
  const extension = file.storageKey.split('.').pop()?.toLowerCase();

  res.set({
    'Content-Type':
      extension === 'pdf' ? 'application/pdf' : 'application/octet-stream',
    /*
     * `attachment` y no `inline`: se descarga en vez de renderizarse dentro del
     * dominio. Y sin cache — un documento privado no tiene por que quedarse en
     * el disco de un proxy intermedio.
     */
    'Content-Disposition': `attachment; filename="${encodeURIComponent(file.originalName)}"`,
    'Cache-Control': 'no-store, private',
    'X-Content-Type-Options': 'nosniff',
  });

  return new StreamableFile(createReadStream(path));
}
