import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Pipeline, PipelineStage } from './domain/pipeline.entity';
import { Client } from './domain/client.entity';
import {
  applyBranchScope,
  applyOwnershipScope,
  assertSameBranch,
  resolveBranch,
} from '../iam/scope';
import { Role, seesAllBranches } from '../iam/domain/role.enum';
import { RequestContext } from '../../shared/request-context/request-context';
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

  /**
   * Los embudos que este usuario puede ver.
   *
   * Dos filtros, y los dos importan:
   *
   *  - Por SEDE: los de su oficina y los de la empresa (sin sede). La
   *    administracion y la direccion las ven todas, y si tienen una puesta en el
   *    selector, esa.
   *  - Por PERFIL: los que le nombran, mas los que no nombran a nadie —que
   *    significa "para todos"—. La administracion se salta este filtro: si no
   *    viera los embudos que reparte, no podria repartirlos.
   *
   * Se resuelve en SQL y no filtrando en memoria: un embudo que no se puede ver
   * tampoco debe viajar por la red.
   */
  findAll(actor: AuthenticatedActor): Promise<Pipeline[]> {
    const qb = this.pipelines
      .createQueryBuilder('pipeline')
      .leftJoinAndSelect('pipeline.stages', 'stage')
      .orderBy('pipeline.position', 'ASC')
      .addOrderBy('stage.position', 'ASC');

    if (seesAllBranches(actor.role as Role)) {
      // Con una sede elegida en el selector, los suyos y los de la empresa.
      const elegida = RequestContext.branchId();
      if (elegida) {
        qb.andWhere(
          '(pipeline.branch_id = :elegida OR pipeline.branch_id IS NULL)',
          { elegida },
        );
      }
    } else {
      qb.andWhere(
        '(pipeline.branch_id = :propia OR pipeline.branch_id IS NULL)',
        { propia: actor.branchId ?? null },
      );
      qb.andWhere(
        `(jsonb_array_length(pipeline.visible_roles) = 0 OR pipeline.visible_roles ? :rol)`,
        { rol: actor.role },
      );
    }

    return qb.getMany();
  }

  /** Un embudo, comprobando que este usuario tenga derecho a verlo. */
  async findVisible(id: string, actor: AuthenticatedActor): Promise<Pipeline> {
    const visibles = await this.findAll(actor);
    const suyo = visibles.find((p) => p.id === id);
    if (!suyo) throw new NotFoundException(`Embudo ${id} no encontrado`);
    return suyo;
  }

  /**
   * Crea un embudo.
   *
   * Quien manda en una sede lo crea PARA su sede y no puede elegir otra; la
   * administracion decide, y sin sede queda como embudo de empresa.
   */
  async create(
    actor: AuthenticatedActor,
    datos: { name: string; branchId?: string | null; visibleRoles?: string[] },
  ): Promise<Pipeline> {
    const deEmpresa =
      seesAllBranches(actor.role as Role) && datos.branchId === null;
    const branchId = deEmpresa
      ? null
      : resolveBranch(actor, datos.branchId ?? undefined);

    const ultimo = await this.pipelines
      .createQueryBuilder('pipeline')
      .select('MAX(pipeline.position)', 'max')
      .getRawOne<{ max: number | null }>();

    return this.pipelines.save(
      this.pipelines.create({
        name: datos.name.trim(),
        branchId,
        visibleRoles: datos.visibleRoles ?? [],
        position: (ultimo?.max ?? 0) + 1,
        isDefault: false,
      }),
    );
  }

  /** Cambia nombre y visibilidad. La sede de un embudo no se mueve. */
  async update(
    id: string,
    actor: AuthenticatedActor,
    datos: { name?: string; visibleRoles?: string[] },
  ): Promise<Pipeline> {
    const embudo = await this.findVisible(id, actor);
    assertSameBranch(actor, embudo.branchId);
    if (datos.name !== undefined) embudo.name = datos.name.trim();
    if (datos.visibleRoles !== undefined) {
      embudo.visibleRoles = datos.visibleRoles;
    }
    return this.pipelines.save(embudo);
  }

  /**
   * Retira un embudo.
   *
   * No se borra si tiene clientes dentro: esos clientes se quedarian sin
   * embudo y sin etapa, o sea fuera de todos los tableros y de todos los
   * informes, sin que nadie se entere.
   */
  async remove(id: string, actor: AuthenticatedActor): Promise<void> {
    const embudo = await this.findVisible(id, actor);
    assertSameBranch(actor, embudo.branchId);
    if (embudo.isDefault) {
      throw new BadRequestException(
        'El embudo por defecto no se puede retirar: es donde entran los leads sin clasificar',
      );
    }
    const dentro = await this.clients.count({ where: { pipelineId: id } });
    if (dentro > 0) {
      throw new BadRequestException(
        `Tiene ${dentro} cliente(s) dentro. Muévelos a otro embudo antes de retirarlo`,
      );
    }
    await this.pipelines.softDelete(id);
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
    /*
      El embudo pedido tiene que ser uno de los suyos. Antes bastaba con saber
      su identificador: cualquiera con acceso al tablero podia pedir el embudo
      de captacion de otra sede y ver sus columnas y sus conteos.
    */
    const pipeline = pipelineId
      ? await this.findVisible(pipelineId, actor)
      : await this.findDefault();

    const qb = this.clients
      .createQueryBuilder('client')
      .select('client.stage_id', 'stageId')
      .addSelect('COUNT(*)::int', 'count')
      .where('client.pipeline_id = :pipelineId', { pipelineId: pipeline.id })
      .groupBy('client.stage_id');
    applyOwnershipScope(qb, actor, 'client.assigned_agent_id');
    // El tablero es el de SU sede: si no, el coordinador cuenta columnas con
    // clientes que no puede ni abrir.
    applyBranchScope(qb, 'client.branch_id');

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
    /*
      Aqui NO se acota por sede a proposito: las etapas son de la empresa, no de
      una oficina, y borrar una que otra sede sigue usando dejaria a sus
      clientes apuntando a nada. La cuenta tiene que ser la de todos.
    */
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
