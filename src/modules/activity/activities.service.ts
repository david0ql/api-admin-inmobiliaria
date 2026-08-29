import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, type SelectQueryBuilder } from 'typeorm';
import { RequestContext } from '../../shared/request-context/request-context';
import { Activity, ActivityType } from './domain/activity.entity';

export interface RecordActivityInput {
  type: ActivityType;
  summary: string;
  detail?: string | null;
  clientId?: string | null;
  propertyId?: string | null;
  agentId?: string | null;
  occurredAt?: Date;
  automatic?: boolean;
}

/**
 * Servicio deliberadamente sin dependencias: registra por id y no valida
 * entidades. Asi lo pueden usar CRM y agenda sin crear un ciclo entre modulos.
 */
@Injectable()
export class ActivitiesService {
  constructor(
    @InjectRepository(Activity) private readonly repo: Repository<Activity>,
  ) {}

  record(input: RecordActivityInput): Promise<Activity> {
    return this.repo.save(
      this.repo.create({
        type: input.type,
        summary: input.summary.slice(0, 300),
        detail: input.detail ?? null,
        clientId: input.clientId ?? null,
        propertyId: input.propertyId ?? null,
        agentId: input.agentId ?? null,
        occurredAt: input.occurredAt ?? new Date(),
        automatic:
          input.automatic ??
          [ActivityType.STAGE_CHANGE, ActivityType.ASSIGNMENT].includes(
            input.type,
          ),
      }),
    );
  }

  listForClient(clientId: string, limit = 100): Promise<Activity[]> {
    const qb = this.repo
      .createQueryBuilder('activity')
      .where('activity.client_id = :clientId', { clientId });
    this.acotarPorSede(qb);
    return qb.orderBy('activity.occurred_at', 'DESC').take(limit).getMany();
  }

  listForProperty(propertyId: string, limit = 100): Promise<Activity[]> {
    const qb = this.repo
      .createQueryBuilder('activity')
      .where('activity.property_id = :propertyId', { propertyId });
    this.acotarPorSede(qb);
    return qb.orderBy('activity.occurred_at', 'DESC').take(limit).getMany();
  }

  listForAgent(agentId: string, from: Date, to: Date): Promise<Activity[]> {
    const qb = this.repo
      .createQueryBuilder('activity')
      .where('activity.agent_id = :agentId', { agentId })
      .andWhere('activity.occurred_at BETWEEN :from AND :to', { from, to });
    this.acotarPorSede(qb);
    return qb.orderBy('activity.occurred_at', 'DESC').getMany();
  }

  async remove(id: string): Promise<void> {
    const qb = this.repo
      .createQueryBuilder('activity')
      .where('activity.id = :id', { id });
    this.acotarPorSede(qb);
    if ((await qb.getCount()) === 0) {
      throw new NotFoundException(`Actividad ${id} no encontrada`);
    }
    await this.repo.softDelete(id);
  }

  findById(id: string): Promise<Activity | null> {
    const qb = this.repo
      .createQueryBuilder('activity')
      .where('activity.id = :id', { id });
    this.acotarPorSede(qb);
    return qb.getOne();
  }

  /**
   * La bitacora no tiene sede propia: la hereda del cliente o del inmueble del
   * que habla.
   *
   * Se resuelve con EXISTS sobre esas dos tablas en lugar de duplicar la
   * columna: una actividad se escribe una vez y se lee poco, y una copia mas
   * del dato es una copia mas que se puede quedar desfasada. Las que no cuelgan
   * de nada —notas sueltas— quedan fuera de todas las sedes salvo para quien
   * las ve todas, que es lo prudente.
   */
  private acotarPorSede(qb: SelectQueryBuilder<Activity>): void {
    const branchId = RequestContext.branchId();
    if (!branchId) return;
    qb.andWhere(
      `(EXISTS (SELECT 1 FROM client c
                 WHERE c.id = activity.client_id AND c.branch_id = :sedeActividad)
        OR EXISTS (SELECT 1 FROM property p
                    WHERE p.id = activity.property_id AND p.branch_id = :sedeActividad))`,
      { sedeActividad: branchId },
    );
  }
}
