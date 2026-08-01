import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
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
    return this.repo.find({
      where: { clientId },
      order: { occurredAt: 'DESC' },
      take: limit,
    });
  }

  listForProperty(propertyId: string, limit = 100): Promise<Activity[]> {
    return this.repo.find({
      where: { propertyId },
      order: { occurredAt: 'DESC' },
      take: limit,
    });
  }

  listForAgent(agentId: string, from: Date, to: Date): Promise<Activity[]> {
    return this.repo
      .createQueryBuilder('activity')
      .where('activity.agent_id = :agentId', { agentId })
      .andWhere('activity.occurred_at BETWEEN :from AND :to', { from, to })
      .orderBy('activity.occurred_at', 'DESC')
      .getMany();
  }

  async remove(id: string): Promise<void> {
    await this.repo.softDelete(id);
  }

  findById(id: string): Promise<Activity | null> {
    return this.repo.findOne({ where: { id } });
  }
}
