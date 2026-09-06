import { Logger } from '@nestjs/common';
import type { StorageService } from '../media/storage.service';
import type { ImageGateService } from '../media/image-gate.service';
import { GateProfile, GateSeverity } from '../media/image-gate.rules';
import {
  ConsignmentDocumentType,
  type ConsignmentFile,
  type ConsignmentFileNote,
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

const logger = new Logger('ConsignmentFiles');

/** Como se nombra cada documento cuando hay que decir cual falta. */
const NOMBRE_DOCUMENTO: Record<ConsignmentDocumentType, string> = {
  [ConsignmentDocumentType.TRADITION]: 'el certificado de tradicion',
  [ConsignmentDocumentType.DEED]: 'la escritura',
  [ConsignmentDocumentType.OWNER_ID]: 'la cedula del propietario',
  [ConsignmentDocumentType.PROPERTY_TAX]: 'el recibo de predial',
  [ConsignmentDocumentType.MAINTENANCE_BILL]: 'el recibo de administracion',
};

/**
 * Guarda fotos y documentos de una solicitud.
 *
 * Las fotos pasan por el mismo procesado que el inventario —se recomprimen a
 * WebP en varios anchos— y quedan bajo `/media/`, porque acaban siendo el
 * anuncio. Los documentos se guardan tal cual, que un PDF no se reencodea, y
 * FUERA de lo que se sirve: son la cedula y las escrituras de una persona.
 *
 * Un fichero que falle no tumba el envio entero: se descarta y el resto entra.
 * Perder una foto es molesto; perder la solicitud completa por una foto es
 * peor.
 *
 * Pero descartar no puede ser CALLAR, que es lo que se hacia antes. Todo lo que
 * no acaba en `files` deja constancia en `notes`, con `blocked: true`. El caso
 * que mas duele es el documento: un propietario adjunta la escritura de su
 * casa, el guardado falla por lo que sea, y sin esta lista no se entera nadie —
 * ni el, que cree haberla mandado, ni el asesor, que no sabe que falta. La
 * solicitud queda coja y todo parece correcto.
 *
 * Las fotos pasan por la puerta de calidad con el perfil `REQUEST`, que es el
 * blando a proposito. Quien esta al otro lado es un propietario con el movil en
 * la mano pidiendo que le consignen su casa, no un fotografo entregando un
 * anuncio: si se le rechaza la foto porque la hizo en vertical, no la repite —
 * cierra el formulario, y ahi se pierde un cliente. Por eso aqui solo se
 * bloquea lo que literalmente no se puede ver, y la foto vertical o movida
 * entra con un aviso que lee el asesor cuando revisa la solicitud.
 */
export async function storeConsignmentFiles(
  storage: StorageService,
  gate: ImageGateService,
  requestId: string,
  uploaded: Record<string, Express.Multer.File[] | undefined> | undefined,
): Promise<{ files: ConsignmentFile[]; notes: ConsignmentFileNote[] }> {
  const scope = `consignments/${requestId}`;
  const files: ConsignmentFile[] = [];
  /** Lo que el asesor tiene que ver al abrir la solicitud. */
  const notes: ConsignmentFileNote[] = [];
  const huellas: { checksum: string | null; perceptualHash: string | null }[] =
    [];

  for (const photo of uploaded?.photos ?? []) {
    const veredicto = await gate
      .evaluate(
        photo.buffer,
        photo.originalname,
        GateProfile.REQUEST,
        huellas,
        'esta solicitud',
      )
      .catch(() => null);

    if (veredicto && !veredicto.accepted) {
      notes.push({
        originalName: photo.originalname,
        kind: 'PHOTO',
        message: veredicto.issues
          .filter((i) => i.severity === GateSeverity.BLOCK)
          .map((i) => i.message)
          .join(' '),
        blocked: true,
      });
      continue;
    }
    if (veredicto) {
      huellas.push({
        checksum: veredicto.metrics.checksum,
        perceptualHash: veredicto.metrics.perceptualHash,
      });
      for (const aviso of veredicto.issues.filter(
        (i) => i.severity === GateSeverity.WARN,
      )) {
        notes.push({
          originalName: photo.originalname,
          kind: 'PHOTO',
          message: aviso.message,
          // Entro: es un aviso, no algo que haya que volver a pedir.
          blocked: false,
        });
      }
    }

    const stored = await guardar(
      () => storage.saveImage(photo.buffer, scope, photo.originalname),
      photo.originalname,
    );
    if (stored.ok) {
      files.push({
        kind: 'PHOTO',
        storageKey: stored.value.key,
        url: stored.value.url,
        originalName: photo.originalname,
        bytes: stored.value.bytes,
      });
    } else {
      notes.push({
        originalName: photo.originalname,
        kind: 'PHOTO',
        message:
          'No pudimos guardar esta foto. Pidesela otra vez al propietario: el cree que la mando.',
        blocked: true,
      });
    }
  }

  for (const field of DOCUMENT_FIELDS) {
    for (const document of uploaded?.[field.name] ?? []) {
      const stored = await guardar(
        () =>
          storage.savePrivate(document.buffer, scope, document.originalname),
        document.originalname,
      );
      if (stored.ok) {
        files.push({
          kind: 'DOCUMENT',
          docType: field.docType,
          storageKey: stored.value.key,
          originalName: document.originalname,
          bytes: stored.value.bytes,
        });
      } else {
        notes.push({
          originalName: document.originalname,
          kind: 'DOCUMENT',
          message: `No pudimos guardar ${NOMBRE_DOCUMENTO[field.docType]}. La solicitud esta incompleta: hay que pedirsela otra vez al propietario.`,
          blocked: true,
        });
      }
    }
  }

  // Los que lleguen por el campo antiguo, sin categoria: mejor un PDF sin
  // etiquetar que perderlo.
  for (const document of uploaded?.documents ?? []) {
    const stored = await guardar(
      () => storage.savePrivate(document.buffer, scope, document.originalname),
      document.originalname,
    );
    if (stored.ok) {
      files.push({
        kind: 'DOCUMENT',
        storageKey: stored.value.key,
        originalName: document.originalname,
        bytes: stored.value.bytes,
      });
    } else {
      notes.push({
        originalName: document.originalname,
        kind: 'DOCUMENT',
        message:
          'No pudimos guardar este documento. La solicitud esta incompleta: hay que pedirselo otra vez al propietario.',
        blocked: true,
      });
    }
  }

  return { files, notes };
}

/**
 * Ejecuta un guardado y dice si salio, en vez de tragarse el fallo.
 *
 * El `.catch(() => null)` de antes era exactamente el problema: el fallo no
 * llegaba a ninguna parte. Aqui el hecho sobrevive —quien llama sabe que no se
 * guardo y deja constancia en la solicitud— y el detalle tecnico queda en el
 * log del servidor, que es donde sirve de algo.
 */
async function guardar<T>(
  fn: () => Promise<T>,
  nombre: string,
): Promise<{ ok: true; value: T } | { ok: false }> {
  try {
    return { ok: true, value: await fn() };
  } catch (error) {
    /*
      El motivo tecnico va al LOG, no a la nota.

      "EACCES: permission denied, mkdir '/var/www/.../uploads-private'" no le
      dice nada al asesor —lo que el necesita saber es que falta la escritura y
      que hay que volver a pedirla— y ademas publica rutas del servidor en una
      pantalla. Quien tiene que leer eso es quien puede arreglarlo.
    */
    logger.error(
      `No se pudo guardar "${nombre}": ${error instanceof Error ? error.message : String(error)}`,
    );
    return { ok: false };
  }
}
