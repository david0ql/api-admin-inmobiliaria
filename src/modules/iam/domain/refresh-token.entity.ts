import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from '../../../shared/database/base.entity';
import { Agent } from './agent.entity';

/**
 * Refresh token rotativo. Se guarda solo el hash: si alguien lee la tabla no
 * puede suplantar a nadie. Cada uso emite uno nuevo y revoca el anterior, de
 * modo que reutilizar un token ya canjeado delata un robo de sesion.
 */
@Entity('refresh_token')
export class RefreshToken extends BaseEntity {
  @ManyToOne(() => Agent, { onDelete: 'CASCADE', nullable: false })
  @JoinColumn({ name: 'agent_id' })
  agent: Agent;

  @Index()
  @Column({ name: 'agent_id', type: 'uuid' })
  agentId: string;

  @Index({ unique: true })
  @Column({ type: 'varchar', length: 128 })
  tokenHash: string;

  @Column({ type: 'timestamptz' })
  expiresAt: Date;

  @Column({ type: 'timestamptz', nullable: true })
  revokedAt: Date | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  userAgent: string | null;

  @Column({ type: 'varchar', length: 64, nullable: true })
  ipAddress: string | null;

  get isUsable(): boolean {
    return this.revokedAt === null && this.expiresAt.getTime() > Date.now();
  }
}
