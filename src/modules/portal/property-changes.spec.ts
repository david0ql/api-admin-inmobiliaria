import { PropertyChangesService } from './property-changes.service';
import {
  PropertyChangeAction,
  PropertyChangeStatus,
} from './domain/property-change-request.entity';
import { PublicationStatus } from '../properties/domain/property.enums';

/**
 * Lo que el propietario pide desde el portal no se aplica al pulsar.
 *
 * Inactivar nacio como la excepcion —un interruptor inmediato— y no lo es:
 * bajar un aviso de la web se ve igual que cambiarle el precio, y quien lo
 * pulsa desde su cuenta no siempre sabe que hay una visita agendada encima.
 * Estas pruebas fijan que ninguna de las tres acciones toque el inmueble antes
 * de que alguien del equipo la apruebe.
 */
describe('solicitudes de cambio del propietario', () => {
  const inmueble = {
    id: 'prop-1',
    title: 'Apartamento en Cabecera',
    code: 'SE-100',
    publicationStatus: PublicationStatus.ACTIVE,
  };

  function montar() {
    const guardadas: Record<string, unknown>[] = [];
    const cambios = {
      create: (valores: Record<string, unknown>) => valores,
      save: (valores: Record<string, unknown>) => {
        guardadas.push(valores);
        return Promise.resolve({ id: 'cambio-1', ...valores });
      },
      findOne: () => Promise.resolve(null),
      find: () => Promise.resolve([]),
    };
    const actualizaciones: Record<string, unknown>[] = [];
    const inmuebles = {
      findOne: () => Promise.resolve(inmueble),
      update: (criterio: unknown, valores: Record<string, unknown>) => {
        actualizaciones.push(valores);
        return Promise.resolve(undefined);
      },
      softDelete: () => Promise.resolve(undefined),
    };
    const intereses = { findOne: () => Promise.resolve({ id: 'interes-1' }) };
    const service = new PropertyChangesService(
      cambios as never,
      { find: () => Promise.resolve([{ propagationMinutes: 5 }]) } as never,
      intereses as never,
      inmuebles as never,
    );
    return { service, guardadas, actualizaciones };
  }

  it('inactivar deja una solicitud pendiente y no toca el inmueble', async () => {
    const { service, guardadas, actualizaciones } = montar();

    const solicitud = await service.proposeDeactivate('cliente-1', 'prop-1');

    expect(solicitud.action).toBe(PropertyChangeAction.DEACTIVATE);
    expect(solicitud.status).toBe(PropertyChangeStatus.PENDING);
    expect(guardadas).toHaveLength(1);
    // Lo importante: el inmueble sigue publicado hasta que se apruebe.
    expect(actualizaciones).toHaveLength(0);
  });

  it('guarda el estado anterior para poder mostrar el antes y el despues', async () => {
    const { service } = montar();

    const solicitud = await service.proposeDeactivate('cliente-1', 'prop-1');

    expect(solicitud.beforeValues).toMatchObject({ code: 'SE-100' });
    expect(solicitud.afterValues).toEqual({
      publicationStatus: PublicationStatus.INACTIVE,
    });
  });

  it('al vencer el plazo, una inactivacion aprobada baja el aviso', async () => {
    const { service, actualizaciones } = montar();
    const pendiente = {
      id: 'cambio-1',
      propertyId: 'prop-1',
      action: PropertyChangeAction.DEACTIVATE,
      status: PropertyChangeStatus.APPROVED,
      afterValues: { publicationStatus: PublicationStatus.INACTIVE },
    };
    // La cola devuelve la solicitud vencida una sola vez.
    (service as unknown as { changes: { find: () => Promise<unknown[]>; save: () => Promise<unknown> } }).changes = {
      find: () => Promise.resolve([pendiente]),
      save: () => Promise.resolve(pendiente),
    };

    await service.applyDue();

    expect(actualizaciones).toEqual([
      { publicationStatus: PublicationStatus.INACTIVE },
    ]);
    expect(pendiente.status).toBe(PropertyChangeStatus.APPLIED);
  });
});
