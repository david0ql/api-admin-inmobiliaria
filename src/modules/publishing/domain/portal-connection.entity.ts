import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  OneToOne,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Portal } from '../../catalog/domain/catalogs.entity';

/** Que conector habla con el portal. Uno por integracion, no por portal. */
export enum ConnectorKey {
  FINCARAIZ = 'fincaraiz',
  METROCUADRADO = 'metrocuadrado',
  PROPPIT = 'proppit',
  META = 'meta',
  /** Agregadores que descargan un XML nuestro: Doomos, Clasf, Luxury Estate… */
  FEED = 'feed',
}

/**
 * La conexion de la inmobiliaria con un portal.
 *
 * Tabla aparte de `portal` porque `portal` es un catalogo importado de WASI
 * —su `connected` dice lo que WASI creia, y hoy vale `true` en los dieciocho—
 * y esto es lo que NOSOTROS tenemos: credenciales propias y un conector que
 * sabe hablar con el portal. Sin fila aqui, el portal no sincroniza.
 *
 * Las credenciales van cifradas (AES-256-GCM con `PORTALS_SECRET_KEY`) y la API
 * nunca las devuelve: el panel solo sabe si cada campo esta relleno. Lo que no
 * es secreto —ids de cliente, de catalogo, de sucursal— va en `settings` en
 * claro, porque hay que poder leerlo y corregirlo.
 */
@Entity('portal_connection')
export class PortalConnection {
  @ApiProperty()
  @PrimaryColumn({ name: 'portal_id', type: 'int' })
  portalId: number;

  @OneToOne(() => Portal, { onDelete: 'CASCADE', eager: true })
  @JoinColumn({ name: 'portal_id' })
  portal: Portal;

  @ApiProperty({ enum: ConnectorKey })
  @Column({ type: 'varchar', length: 32 })
  connector: ConnectorKey;

  /**
   * Apagado, el portal no recibe nada: ni altas automaticas ni el boton de la
   * ficha. Nace apagado hasta que alguien pone credenciales y prueba.
   */
  @ApiProperty()
  @Column({ type: 'boolean', default: false })
  enabled: boolean;

  /** Publica automaticamente cada inmueble nuevo en este portal. */
  @ApiProperty()
  @Column({ name: 'auto_publish_new', type: 'boolean', default: true })
  autoPublishNew: boolean;

  /** Entorno de pruebas del portal, si lo tiene. */
  @ApiProperty()
  @Column({ type: 'boolean', default: false })
  sandbox: boolean;

  /** JSON cifrado con las credenciales. Nunca sale de la API. */
  @Column({
    name: 'credentials_enc',
    type: 'text',
    nullable: true,
    select: false,
  })
  credentialsEnc: string | null;

  @ApiProperty({ description: 'Ajustes no secretos del conector' })
  @Column({ type: 'jsonb', default: () => "'{}'::jsonb" })
  settings: Record<string, string>;

  /**
   * Secreto de la URL que el portal llama de vuelta (resultado asincrono) o
   * desde la que descarga el feed. Va en la ruta: quien no lo sabe no puede
   * falsear un "publicado" ni leer el inventario en bloque.
   */
  @Column({ name: 'inbound_token', type: 'varchar', length: 64 })
  inboundToken: string;

  @ApiPropertyOptional({ nullable: true })
  @Column({ name: 'last_check_at', type: 'timestamptz', nullable: true })
  lastCheckAt: Date | null;

  @ApiPropertyOptional({ nullable: true })
  @Column({ name: 'last_check_ok', type: 'boolean', nullable: true })
  lastCheckOk: boolean | null;

  @ApiPropertyOptional({ nullable: true })
  @Column({ name: 'last_check_message', type: 'text', nullable: true })
  lastCheckMessage: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
