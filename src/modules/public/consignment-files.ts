import type { StorageService } from '../media/storage.service';
import {
  ConsignmentDocumentType,
  type ConsignmentFile,
} from './domain/consignment-request.entity';

/**
 * Los cinco documentos del formulario, cada uno en su propio campo del
 * multipart. Un campo por categoria y no un `documents[]` suelto: asi la
 * etiqueta la pone quien la sabe —el formulario— y no hay que adivinarla luego
 * por el nombre del fichero.
 */
export const DOCUMENT_FIELDS = [
  { name: 'docTradition', docType: ConsignmentDocumentType.TRADITION },
  { name: 'docDeed', docType: ConsignmentDocumentType.DEED },
  { name: 'docId', docType: ConsignmentDocumentType.OWNER_ID },
  { name: 'docTax', docType: ConsignmentDocumentType.PROPERTY_TAX },
  { name: 'docMaintenance', docType: ConsignmentDocumentType.MAINTENANCE_BILL },
] as const;

/**
 * Guarda fotos y documentos de una solicitud.
 *
 * Las fotos pasan por el mismo procesado que el inventario —se recomprimen a
 * WebP en varios anchos—; los documentos se guardan tal cual, que un PDF no se
 * reencodea, pero pasando la inspeccion de firma de `saveRaw`.
 *
 * Un fichero que falle no tumba el envio entero: se descarta y el resto entra.
 * Perder una foto es molesto; perder la solicitud completa por una foto es
 * peor.
 */
export async function storeConsignmentFiles(
  storage: StorageService,
  requestId: string,
  uploaded: Record<string, Express.Multer.File[] | undefined> | undefined,
): Promise<ConsignmentFile[]> {
  const scope = `consignments/${requestId}`;
  const files: ConsignmentFile[] = [];

  for (const photo of uploaded?.photos ?? []) {
    const stored = await storage
      .saveImage(photo.buffer, scope, photo.originalname)
      .catch(() => null);
    if (stored) {
      files.push({
        kind: 'PHOTO',
        storageKey: stored.key,
        url: stored.url,
        originalName: photo.originalname,
        bytes: stored.bytes,
      });
    }
  }

  for (const field of DOCUMENT_FIELDS) {
    for (const document of uploaded?.[field.name] ?? []) {
      const stored = await storage
        .saveRaw(document.buffer, scope, document.originalname)
        .catch(() => null);
      if (stored) {
        files.push({
          kind: 'DOCUMENT',
          docType: field.docType,
          storageKey: stored.key,
          url: stored.url,
          originalName: document.originalname,
          bytes: stored.bytes,
        });
      }
    }
  }

  // Los que lleguen por el campo antiguo, sin categoria: mejor un PDF sin
  // etiquetar que perderlo.
  for (const document of uploaded?.documents ?? []) {
    const stored = await storage
      .saveRaw(document.buffer, scope, document.originalname)
      .catch(() => null);
    if (stored) {
      files.push({
        kind: 'DOCUMENT',
        storageKey: stored.key,
        url: stored.url,
        originalName: document.originalname,
        bytes: stored.bytes,
      });
    }
  }

  return files;
}
