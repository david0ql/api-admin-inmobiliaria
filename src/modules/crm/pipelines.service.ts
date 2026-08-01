import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Pipeline, PipelineStage } from './domain/pipeline.entity';
import { Client } from './domain/client.entity';
import { applyOwnershipScope } from '../iam/scope';
import type { AuthenticatedActor } from '../../shared/request-context/request-context';

export interface KanbanStage {
  id: string;
  name: string;
  position: number;
  color: string;
  isWon: boolean;
  isLost: boolean;
  count: number;
}

@Injectable()
export class PipelinesService {
  constructor(
    @InjectRepository(Pipeline)
    private readonly pipelines: Repository<Pipeline>,
    @InjectRepository(PipelineStage)
    private readonly stages: Repository<PipelineStage>,
    @InjectRepository(Client) private readonly clients: Repository<Client>,
  ) {}

  findAll(): Promise<Pipeline[]> {
    return this.pipelines.find({
      relations: { stages: true },
      order: { position: 'ASC', stages: { position: 'ASC' } },
    });
  }

  async findById(id: string): Promise<Pipeline> {
    const pipeline = await this.pipelines.findOne({
      where: { id },
      relations: { stages: true },
      order: { stages: { position: 'ASC' } },
    });
    if (!pipeline) throw new NotFoundException(`Embudo ${id} no encontrado`);
    return pipeline;
  }

  async findDefault(): Promise<Pipeline> {
    const pipeline = await this.pipelines.findOne({
      where: { isDefault: true },
      relations: { stages: true },
      order: { stages: { position: 'ASC' } },
    });
    if (!pipeline) {
      throw new BadRequestException(
        'No hay ningun embudo marcado por defecto: crea uno antes de dar de alta clientes',
      );
    }
    return pipeline;
  }

  async findStage(id: string): Promise<PipelineStage> {
    const stage = await this.stages.findOne({ where: { id } });
    if (!stage) throw new NotFoundException(`Etapa ${id} no encontrada`);
    return stage;
  }

  /**
   * Tablero completo en una sola consulta: etapas con el numero de clientes en
   * cada una, respetando la visibilidad del asesor. Sin esto el frontend haria
   * una peticion por columna.
   */
  async kanban(
    pipelineId: string | undefined,
    actor: AuthenticatedActor,
  ): Promise<{ pipeline: Pipeline; stages: KanbanStage[] }> {
    const pipeline = pipelineId
      ? await this.findById(pipelineId)
      : await this.findDefault();

    const qb = this.clients
      .createQueryBuilder('client')
      .select('client.stage_id', 'stageId')
      .addSelect('COUNT(*)::int', 'count')
      .where('client.pipeline_id = :pipelineId', { pipelineId: pipeline.id })
      .groupBy('client.stage_id');
    applyOwnershipScope(qb, actor, 'client.assigned_agent_id');

    const rows = await qb.getRawMany<{ stageId: string; count: number }>();
    const counts = new Map(rows.map((r) => [r.stageId, r.count]));

    const stages = [...pipeline.stages]
      .sort((a, b) => a.position - b.position)
      .map((s) => ({
        id: s.id,
        name: s.name,
        position: s.position,
        color: s.color,
        isWon: s.isWon,
        isLost: s.isLost,
        count: counts.get(s.id) ?? 0,
      }));

    return { pipeline, stages };
  }

  async createStage(
    pipelineId: string,
    data: Partial<PipelineStage>,
  ): Promise<PipelineStage> {
    await this.findById(pipelineId);
    if (data.isWon && data.isLost) {
      throw new BadRequestException(
        'Una etapa no puede ser de exito y de descarte a la vez',
      );
    }
    const last = await this.stages.findOne({
      where: { pipelineId },
      order: { position: 'DESC' },
    });
    return this.stages.save(
      this.stages.create({
        ...data,
        pipelineId,
        position: data.position ?? (last ? last.position + 1 : 0),
      }),
    );
  }

  async updateStage(
    id: string,
    data: Partial<PipelineStage>,
  ): Promise<PipelineStage> {
    const stage = await this.findStage(id);
    Object.assign(stage, data);
    if (stage.isWon && stage.isLost) {
      throw new BadRequestException(
        'Una etapa no puede ser de exito y de descarte a la vez',
      );
    }
    return this.stages.save(stage);
  }

  async deleteStage(id: string): Promise<void> {
    const stage = await this.findStage(id);
    const inUse = await this.clients.count({ where: { stageId: id } });
    if (inUse > 0) {
      throw new BadRequestException(
        `La etapa "${stage.name}" tiene ${inUse} clientes: muevelos antes de borrarla`,
      );
    }
    await this.stages.delete(id);
  }

  async count(): Promise<number> {
    return this.pipelines.count();
  }
}
