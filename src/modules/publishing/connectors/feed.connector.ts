import { Injectable } from '@nestjs/common';
import { ConnectorKey } from '../domain/portal-connection.entity';
import { PublicationState } from '../domain/property-publication.entity';
import type {
  ConnectorContext,
  ConnectorField,
  PortalConnector,
  SyncOutcome,
} from '../sync/connector';
import type { PortalListing } from '../sync/listing';
import { clasfProblems } from '../sync/feed-xml';

/**
 * Agregadores que leen un XML nuestro: Doomos, Clasf, Luxury Estate, Anuto,
 * Arriendo.com…
 *
 * Aqui no se llama a nadie. "Enviar" es meter el inmueble en el feed y
 * "retirar" es sacarlo; el portal se entera en su siguiente lectura, que suele
 * ser diaria. Por eso el estado que queda es PUBLISHED con una nota que lo
 * dice: publicado en nuestro lado, pendiente de que el portal pase.
 *
 * El XML lo sirve `FeedController` en una URL con el token de la conexion.
 */
@Injectable()
export class FeedConnector implements PortalConnector {
  readonly key = ConnectorKey.FEED;
  readonly mode = 'feed' as const;
  readonly credentialFields: ConnectorField[] = [];
  readonly settingFields: ConnectorField[] = [
    {
      key: 'format',
      label: 'Formato del XML',
      secret: false,
      required: false,
      help: 'trovit (por defecto) o clasf.',
    },
    {
      key: 'agencyName',
      label: 'Nombre de la inmobiliaria en los anuncios',
      secret: false,
      required: false,
    },
    {
      key: 'contactEmail',
      label: 'Correo de contacto en los anuncios',
      secret: false,
      required: false,
      help: 'Si se deja vacio, se usa el del asesor a cargo.',
    },
    {
      key: 'contactPhone',
      label: 'Telefono de contacto en los anuncios',
      secret: false,
      required: false,
    },
  ];
  readonly instructions =
    'Copia la URL del feed y registrala en el portal (formulario de agencias o correo a soporte). El portal la lee periodicamente.';

  test(): Promise<string> {
    return Promise.resolve(
      'No hay nada que probar: el portal descarga el feed desde la URL.',
    );
  }

  validate(listing: PortalListing, ctx: ConnectorContext): string[] {
    const faltas: string[] = [];
    if (!listing.salePrice && !listing.rentPrice)
      faltas.push('Falta el precio');
    if (!listing.description) faltas.push('Falta la descripcion');
    if (ctx.settings.format === 'clasf') {
      faltas.push(...clasfProblems(listing, ctx.settings));
    }
    return faltas;
  }

  upsert(ctx: ConnectorContext, listing: PortalListing): Promise<SyncOutcome> {
    return Promise.resolve({
      state: PublicationState.PUBLISHED,
      externalId: listing.code,
      note: `Incluido en el feed de ${ctx.portalName}; aparece cuando el portal lo vuelva a leer.`,
    });
  }

  remove(ctx: ConnectorContext): Promise<SyncOutcome> {
    return Promise.resolve({
      state: PublicationState.REMOVED,
      note: `Fuera del feed de ${ctx.portalName}; desaparece cuando el portal lo vuelva a leer.`,
    });
  }
}
