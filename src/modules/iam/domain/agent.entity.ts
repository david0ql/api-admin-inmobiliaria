import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Column, Entity, Index, OneToMany } from 'typeorm';
import { BaseEntity } from '../../../shared/database/base.entity';
import { AgentStatus, Role } from './role.enum';
import { AgentShift } from './agent-shift.entity';

/**
 * Asesor / usuario interno. Se llama `agent` y no `user` porque en el dominio
 * inmobiliario "usuario" es ambiguo: el cliente tambien lo es.
 *
 * En el volcado de WASI hay 6 usuarios activos, pero los clientes referencian
 * otros 3 ids (40297, 167632, 253600) de asesores ya dados de baja — uno de
 * ellos con 1.211 clientes asignados. Se importan con estado INACTIVE para no
 * perder la trazabilidad de esa cartera.
 */
@Entity('agent')
export class Agent extends BaseEntity {
  @ApiPropertyOptional({ description: 'id_user original en WASI' })
  @Index({ unique: true, where: '"wasi_id" IS NOT NULL' })
  @Column({ type: 'int', nullable: true })
  wasiId: number | null;

  @ApiProperty()
  @Column({ type: 'varchar', length: 120 })
  firstName: string;

  @ApiPropertyOptional({ nullable: true })
  @Column({ type: 'varchar', length: 120, nullable: true })
  lastName: string | null;

  @ApiProperty()
  @Index({ unique: true })
  @Column({ type: 'varchar', length: 180 })
  email: string;

  /** Nulo mientras el asesor importado no haya establecido contrasena. */
  @Column({ type: 'varchar', length: 255, nullable: true, select: false })
  passwordHash: string | null;

  @ApiProperty()
  @Column({ type: 'boolean', default: true })
  mustSetPassword: boolean;

  @ApiPropertyOptional({ nullable: true })
  @Column({ type: 'varchar', length: 32, nullable: true })
  cellPhone: string | null;

  @ApiProperty()
  @Column({ type: 'boolean', default: false })
  hasWhatsapp: boolean;

  @ApiPropertyOptional({ nullable: true })
  @Column({ type: 'text', nullable: true })
  photoUrl: string | null;

  @ApiProperty({ enum: Role })
  @Column({ type: 'enum', enum: Role, default: Role.AGENT })
  role: Role;

  @ApiProperty({ enum: AgentStatus })
  @Index()
  @Column({ type: 'enum', enum: AgentStatus, default: AgentStatus.ACTIVE })
  status: AgentStatus;

  @ApiPropertyOptional({ nullable: true })
  @Column({ type: 'timestamptz', nullable: true })
  lastLoginAt: Date | null;

  @OneToMany(() => AgentShift, (shift) => shift.agent)
  shifts: AgentShift[];

  @ApiProperty()
  get fullName(): string {
    return [this.firstName, this.lastName].filter(Boolean).join(' ').trim();
  }
}
