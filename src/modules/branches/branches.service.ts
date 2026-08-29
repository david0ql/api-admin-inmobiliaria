import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Branch } from './domain/branch.entity';
import { Agent } from '../iam/domain/agent.entity';
import { Role, seesAllBranches } from '../iam/domain/role.enum';
import { RequestContext } from '../../shared/request-context/request-context';

@Injectable()
export class BranchesService {
  constructor(
    @InjectRepository(Branch) private readonly branches: Repository<Branch>,
    @InjectRepository(Agent) private readonly agents: Repository<Agent>,
  ) {}

  /**
   * Las sedes que puede ver quien pregunta.
   *
   * Quien pertenece a una ve solo la suya —no una lista con las demas en gris:
   * saber que existe una oficina en Bogota ya es informacion que no le toca—.
   */
  async list(): Promise<Branch[]> {
    const actor = RequestContext.actor();
    if (!actor) return [];

    if (seesAllBranches(actor.role as Role)) {
      return this.branches.find({ order: { isDefault: 'DESC', name: 'ASC' } });
    }

    if (!actor.branchId) return [];
    return this.branches.find({ where: { id: actor.branchId } });
  }

  async findOne(id: string): Promise<Branch> {
    const branch = await this.branches.findOne({ where: { id } });
    if (!branch) throw new NotFoundException('Sede no encontrada');
    return branch;
  }

  async create(data: Partial<Branch>): Promise<Branch> {
    return this.branches.save(
      this.branches.create({
        ...data,
        // La sede por defecto se decide una vez, en la migracion. Crear otra
        // "por defecto" dejaria dos, y el sistema tiene que saber cual es LA
        // que hereda lo que no dice de donde es.
        isDefault: false,
      }),
    );
  }

  async update(id: string, data: Partial<Branch>): Promise<Branch> {
    const branch = await this.findOne(id);

    if (branch.isDefault && data.active === false) {
      throw new BadRequestException(
        'La sede principal no se puede desactivar: es donde caen los registros que no dicen de dónde son',
      );
    }

    await this.branches.update({ id }, { ...data, isDefault: branch.isDefault });
    return this.findOne(id);
  }

  /**
   * Poner —o cambiar— al coordinador de una sede.
   *
   * Es el paso que la agencia hace tras crear la oficina: sin coordinador, la
   * sede existe pero no la lleva nadie y sus asesores no tendrian quien les
   * cree la cuenta.
   */
  async setCoordinator(branchId: string, agentId: string): Promise<Agent> {
    const branch = await this.findOne(branchId);
    const agent = await this.agents.findOne({ where: { id: agentId } });
    if (!agent) throw new NotFoundException('Usuario no encontrado');

    if (seesAllBranches(agent.role)) {
      throw new BadRequestException(
        'Quien ve todas las sedes no puede coordinar una sola',
      );
    }

    await this.agents.update(
      { id: agent.id },
      { role: Role.COORDINATOR, branchId: branch.id },
    );

    return this.agents.findOneOrFail({ where: { id: agent.id } });
  }

  /**
   * Quien coordina cada sede, para pintarlo en el listado.
   *
   * Con `Not(null)` TypeORM escribia `!= NULL`, que en SQL no es falso ni
   * verdadero sino desconocido: la consulta no devolvia a nadie y el panel
   * enseñaba "sin coordinador" en una sede que si lo tenia. Va con
   * `IS NOT NULL`, que es la unica forma de preguntar por un nulo.
   */
  async coordinators(): Promise<Agent[]> {
    return this.agents
      .createQueryBuilder('agent')
      .where('agent.role = :role', { role: Role.COORDINATOR })
      .andWhere('agent.branch_id IS NOT NULL')
      .orderBy('agent.first_name', 'ASC')
      .getMany();
  }

  /** El equipo de una sede. Lo usa el coordinador para gestionar los suyos. */
  async team(branchId: string): Promise<Agent[]> {
    const actor = RequestContext.actor();
    if (
      actor &&
      !seesAllBranches(actor.role as Role) &&
      actor.branchId !== branchId
    ) {
      throw new ForbiddenException('Esa sede no es la tuya');
    }
    return this.agents.find({
      where: { branchId },
      order: { fullName: 'ASC' },
    });
  }
}
