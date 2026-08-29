import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from '../../../shared/database/base.entity';
import { Agent } from '../../iam/domain/agent.entity';

export enum AttendanceMarkType {
  /** "Ya entré". */
  IN = 'IN',
  /** "Ya me voy". */
  OUT = 'OUT',
}

/**
 * Una marca de asistencia: el hecho de que alguien dijo que entraba o que se
 * iba, con el instante y el sitio desde donde lo dijo.
 *
 * La tabla guarda MARCAS, no jornadas. Una jornada —"entré a las 8 y salí a
 * las 12"— es el resultado de emparejar dos marcas, y guardarla ademas como
 * fila propia obligaria a mantener dos verdades: el dia que alguien corrige
 * una hora o mete una salida a destiempo, la jornada guardada y sus marcas
 * dejan de decir lo mismo y ya no hay forma de saber cual manda. Emparejar al
 * leer cuesta un bucle; tener dos verdades cuesta el fichaje de la gente.
 *
 * En un dia caben varias entradas y varias salidas: el almuerzo, salir a
 * mostrar un inmueble, volver. Lo unico que no cabe es repetir la misma marca
 * dos veces seguidas, y eso se comprueba al escribir (409), no aqui.
 */
@Entity('attendance_mark')
// La consulta del panel filtra siempre por persona y por fecha, y la de
// "mi estado" busca la ultima marca de una persona: el mismo indice sirve.
@Index(['agentId', 'happenedAt'])
@Index(['branchId', 'happenedAt'])
export class AttendanceMark extends BaseEntity {
  @ApiProperty({ enum: AttendanceMarkType })
  @Column({ type: 'enum', enum: AttendanceMarkType })
  type: AttendanceMarkType;

  /**
   * El instante exacto, con zona.
   *
   * Se guarda en UTC y el "dia" se calcula al leer con `AT TIME ZONE
   * 'America/Bogota'`: una salida a las 20:00 de Bucaramanga es la 01:00 UTC
   * del dia siguiente, y agrupando en UTC esa jornada saldria partida en dos
   * dias.
   */
  @ApiProperty()
  @Column({ type: 'timestamptz' })
  happenedAt: Date;

  @ManyToOne(() => Agent, { onDelete: 'CASCADE', nullable: false })
  @JoinColumn({ name: 'agent_id' })
  agent: Agent;

  @ApiProperty({ format: 'uuid' })
  @Column({ name: 'agent_id', type: 'uuid' })
  agentId: string;

  /**
   * La sede de quien marca, copiada al marcar.
   *
   * Nula solo para quien no pertenece a ninguna porque las ve todas —el
   * administrador y la direccion—. Se copia y no se lee del agente porque un
   * traslado de sede no puede reescribir donde estuvo fichando alguien el
   * trimestre pasado.
   */
  @ApiPropertyOptional({ nullable: true, format: 'uuid' })
  @Column({ name: 'branch_id', type: 'uuid', nullable: true })
  branchId: string | null;

  /*
    Grados decimales en coma flotante y no `numeric`: el mapa necesita numeros
    y `numeric` llega a JavaScript como texto. La precision de un `double` son
    quince digitos significativos, mas que de sobra para los siete que tiene
    una coordenada al centimetro.
  */
  @ApiProperty({ example: 7.119349 })
  @Column({ type: 'double precision' })
  latitude: number;

  @ApiProperty({ example: -73.122741 })
  @Column({ type: 'double precision' })
  longitude: number;

  /** Radio de incertidumbre que reporto el GPS, en metros. */
  @ApiPropertyOptional({ nullable: true, example: 18 })
  @Column({ name: 'accuracy_m', type: 'int', nullable: true })
  accuracyM: number | null;

  /**
   * La direccion legible del punto, resuelta en el servidor al marcar.
   *
   * Se guarda denormalizada porque es un hecho de ese momento: dentro de un
   * año el servicio de geocodificacion puede llamar a ese barrio de otra
   * manera, o no existir, y la marca tiene que seguir diciendo desde donde se
   * hizo. Nula cuando el servicio de terceros no respondio: perder el fichaje
   * de alguien porque un tercero fallo seria mucho peor que no tener el texto.
   */
  @ApiPropertyOptional({
    nullable: true,
    example: 'Cabecera del Llano, Bucaramanga, Santander',
  })
  @Column({ type: 'varchar', length: 300, nullable: true })
  address: string | null;
}
