import { ApiProperty } from '@nestjs/swagger';
import { Column, Entity } from 'typeorm';
import { BaseEntity } from '../../../shared/database/base.entity';

/** De dónde salen los inmuebles del carrusel de la portada. */
export enum ShowcaseSource {
  /** Los últimos publicados. Se actualiza solo. */
  RECENT = 'RECENT',
  /** Los destacados del inventario (`OUTSTANDING`). */
  OUTSTANDING = 'OUTSTANDING',
  /** Los que elija la agencia, por código y en su orden. */
  MANUAL = 'MANUAL',
}

/** Cómo pasa de uno a otro. */
export enum ShowcaseEffect {
  /** Se deslizan. Es lo que se espera de un carrusel. */
  SLIDE = 'SLIDE',
  /** Se funden. Más tranquilo, y no arrastra la vista. */
  FADE = 'FADE',
}

/**
 * El escaparate de la portada.
 *
 * Qué inmuebles salen, cuántos, si pasan solos y cómo. Estaba escrito en el
 * código —los nueve últimos, quietos— y cambiar cualquiera de esas cosas pedía
 * un despliegue. Es justo lo que una agencia quiere mover: la semana que tiene
 * tres casas buenas quiere enseñar esas, no las últimas que subió.
 *
 * Fila única, como el resto de ajustes del sitio.
 */
@Entity('home_settings')
export class HomeSettings extends BaseEntity {
  @ApiProperty({ enum: ShowcaseSource })
  @Column({
    type: 'enum',
    enum: ShowcaseSource,
    default: ShowcaseSource.RECENT,
  })
  source: ShowcaseSource;

  /**
   * Los códigos elegidos a mano, en el orden en que deben salir.
   *
   * Solo cuenta cuando `source` es `MANUAL`. Se guardan aunque se cambie de
   * modo: quien vuelve a "elegidos" recupera su selección en lugar de tener
   * que rehacerla.
   */
  @ApiProperty({ type: [String] })
  @Column({ type: 'jsonb', default: () => "'[]'" })
  codes: string[];

  @ApiProperty({ description: 'Cuántos inmuebles entran en el carrusel.' })
  @Column({ type: 'int', default: 9 })
  count: number;

  @ApiProperty({ description: 'Si pasan solos.' })
  @Column({ type: 'boolean', default: true })
  autoplay: boolean;

  /** Cuánto se queda cada grupo antes de pasar, en milisegundos. */
  @ApiProperty()
  @Column({ type: 'int', default: 5000 })
  delayMs: number;

  @ApiProperty({ enum: ShowcaseEffect })
  @Column({ type: 'enum', enum: ShowcaseEffect, default: ShowcaseEffect.SLIDE })
  effect: ShowcaseEffect;
}
