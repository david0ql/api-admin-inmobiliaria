import { ApiProperty } from '@nestjs/swagger';
import { Column, Entity, Index, Unique } from 'typeorm';
import { BaseEntity } from '../../../shared/database/base.entity';

export const LOCALES = ['es', 'en'] as const;
export type Locale = (typeof LOCALES)[number];

/**
 * Una frase de la web, en un idioma.
 *
 * Solo se guardan las que alguien ha tocado desde el panel. El texto de partida
 * vive en un fichero del repositorio —`defaults/es.json` y `defaults/en.json`—
 * porque es lo que escribe quien programa: guardarlo todo en la base obligaría
 * a una migración por cada frase nueva y dejaría la web dependiendo de que la
 * base tenga la fila.
 *
 * Así, esta tabla es la capa de encima: lo que la agencia decidió decir en vez
 * de lo que venía escrito. Borrar una fila devuelve la frase original.
 */
@Entity('translation')
@Unique(['locale', 'key'])
@Index(['locale'])
export class Translation extends BaseEntity {
  @ApiProperty({ example: 'es' })
  @Column({ type: 'varchar', length: 5 })
  locale: Locale;

  @ApiProperty({ example: 'home.search.title' })
  @Column({ type: 'varchar', length: 160 })
  key: string;

  @ApiProperty()
  @Column({ type: 'text' })
  value: string;
}
