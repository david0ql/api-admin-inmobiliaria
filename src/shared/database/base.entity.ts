import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  CreateDateColumn,
  DeleteDateColumn,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

/**
 * Base de todas las entidades operativas: UUID como clave primaria (no expone
 * volumen de negocio ni permite enumerar), marcas de tiempo y borrado logico.
 *
 * Los catalogos (pais, tipo de inmueble, portal...) NO heredan de aqui: usan el
 * id entero de WASI como clave, que es estable y hace el import trivial.
 */
export abstract class BaseEntity {
  @ApiProperty({ format: 'uuid' })
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ApiProperty()
  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @ApiProperty()
  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;

  @ApiPropertyOptional({ nullable: true })
  @DeleteDateColumn({ type: 'timestamptz', nullable: true })
  deletedAt: Date | null;
}
