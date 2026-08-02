import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from '../../../shared/database/base.entity';
import { Client } from '../../crm/domain/client.entity';

/**
 * Refresh token del portal del cliente.
 *
 * Tabla propia y no una columna nullable en `refresh_token`: una fila que
 * pudiera ser de un asesor o de un cliente es una confusion de tipos esperando
 * a que alguien olvide el filtro. Aqui, un token de cliente no puede acabar en
 * una sesion de asesor porque no cabe en la misma tabla.
 *
 * Como en el de los asesores, se guarda solo el hash y cada uso emite uno nuevo:
 * reutilizar uno ya canjeado delata un robo y tumba todas las sesiones.
 */
@Entity('client_refresh_token')
export class ClientRefreshToken extends BaseEntity {
  @ManyToOne(() => Client, { onDelete: 'CASCADE', nullable: false })
  @JoinColumn({ name: 'client_id' })
  client: Client;

  @Index()
  @Column({ name: 'client_id', type: 'uuid' })
  clientId: string;

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
