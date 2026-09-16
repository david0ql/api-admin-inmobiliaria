import { Column, Entity, Index } from 'typeorm';
import { BaseEntity } from '../../../shared/database/base.entity';

export enum PropertyChangeAction {
  UPDATE = 'UPDATE',
  ARCHIVE = 'ARCHIVE',
}

export enum PropertyChangeStatus {
  PENDING = 'PENDING',
  APPROVED = 'APPROVED',
  APPLIED = 'APPLIED',
  REJECTED = 'REJECTED',
}

@Entity('property_change_request')
@Index(['status', 'applyAfter'])
@Index(['clientId', 'createdAt'])
export class PropertyChangeRequest extends BaseEntity {
  @Column({ name: 'property_id', type: 'uuid' }) propertyId: string;
  @Column({ name: 'client_id', type: 'uuid' }) clientId: string;
  @Column({ type: 'enum', enum: PropertyChangeAction }) action: PropertyChangeAction;
  @Column({ type: 'enum', enum: PropertyChangeStatus, default: PropertyChangeStatus.PENDING }) status: PropertyChangeStatus;
  @Column({ name: 'before_values', type: 'jsonb' }) beforeValues: Record<string, unknown>;
  @Column({ name: 'after_values', type: 'jsonb' }) afterValues: Record<string, unknown>;
  @Column({ name: 'reviewed_by_agent_id', type: 'uuid', nullable: true }) reviewedByAgentId: string | null;
  @Column({ name: 'reviewed_at', type: 'timestamptz', nullable: true }) reviewedAt: Date | null;
  @Column({ name: 'apply_after', type: 'timestamptz', nullable: true }) applyAfter: Date | null;
  @Column({ name: 'applied_at', type: 'timestamptz', nullable: true }) appliedAt: Date | null;
  @Column({ type: 'text', nullable: true }) resolution: string | null;
}

@Entity('portal_change_settings')
export class PortalChangeSettings extends BaseEntity {
  @Column({ name: 'propagation_minutes', type: 'integer', default: 5 })
  propagationMinutes: number;
}
