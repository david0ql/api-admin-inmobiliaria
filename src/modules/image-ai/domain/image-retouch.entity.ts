import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from '../../../shared/database/base.entity';
import { PropertyImage } from '../../properties/domain/property-image.entity';
import { RetouchKind, RetouchStatus } from './image-retouch.enums';

/**
 * Un retoque con IA sobre UNA foto: que se pidio, que salio, quien lo decidio.
 *
 * Esta tabla es la memoria del catalogo. Dentro de seis meses, la unica forma
 * de contestar "¿cual de estas 6.306 fotos es una foto y cual es un dibujo?" es
 * esta fila — porque en el fichero no queda ni rastro. Se comprobo: el PNG que
 * devuelve OpenAI trae dentro su firma de procedencia C2PA, y nuestro propio
 * `StorageService` la destruye al reencodear a WebP, que es lo que tiene que
 * hacer. Asi que la procedencia no vive en la imagen: vive aqui o no vive.
 *
 * Una fila por intento, tambien por los descartados y los fallidos. Guardar
 * solo lo aceptado contaria una historia falsa —"la IA acierta siempre"— y
 * ademas cada intento se pago, con lo que borrarlo es perder la unica cuenta
 * real de lo que cuesta la funcion.
 *
 * NO hay clave unica sobre la imagen: la misma foto se puede retocar muchas
 * veces, con instrucciones distintas, y comparar los intentos es justo lo que
 * el asesor necesita para elegir.
 */
@Entity('image_retouch')
@Index(['propertyImageId'])
@Index(['propertyId'])
@Index(['status'])
export class ImageRetouch extends BaseEntity {
  @ManyToOne(() => PropertyImage, { onDelete: 'CASCADE', nullable: false })
  @JoinColumn({ name: 'property_image_id' })
  image: PropertyImage;

  @ApiProperty()
  @Column({ name: 'property_image_id', type: 'uuid' })
  propertyImageId: string;

  /** Redundante con la imagen; deja auditar un inmueble entero sin join. */
  @ApiProperty()
  @Column({ name: 'property_id', type: 'uuid' })
  propertyId: string;

  // --- que se pidio ---------------------------------------------------------

  /**
   * Lo que escribio la persona, literal y sin normalizar.
   *
   * Se guarda tal cual y no reformulado: es la prueba de que se pidio. Si
   * dentro de un año hay que explicar por que una fachada salio con cielo azul,
   * la respuesta no puede ser una parafrasis nuestra.
   */
  @ApiProperty({ example: 'Sube la luz de la alcoba, esta muy oscura' })
  @Column({ type: 'varchar', length: 1000 })
  instruction: string;

  @ApiProperty({ enum: RetouchKind })
  @Column({ type: 'enum', enum: RetouchKind, enumName: 'retouch_kind_enum' })
  kind: RetouchKind;

  /**
   * Las palabras que decidieron la categoria.
   *
   * Sin esto la clasificacion es un oraculo. Con esto, un asesor que no
   * entiende por que su peticion quedo marcada como alteracion ve que fue por
   * la palabra "cielo", y quien mantiene el lexico sabe que corregir.
   */
  @ApiProperty({ type: [String] })
  @Column({ type: 'jsonb', default: () => "'[]'::jsonb" })
  motivos: string[];

  /**
   * El texto completo que se le mando al modelo: encabezado documental mas la
   * instruccion. Es lo unico que permite saber, mas adelante, si un resultado
   * raro vino de lo que pidio el asesor o de como se lo contamos al modelo.
   */
  @ApiProperty()
  @Column({ name: 'prompt_enviado', type: 'text' })
  promptEnviado: string;

  // --- con que se hizo ------------------------------------------------------

  @ApiProperty({ example: 'gpt-image-2' })
  @Column({ type: 'varchar', length: 80 })
  model: string;

  @ApiProperty({ example: 'high' })
  @Column({ type: 'varchar', length: 20 })
  quality: string;

  @ApiProperty({ example: '1584x1056' })
  @Column({ type: 'varchar', length: 20 })
  size: string;

  // --- que costo ------------------------------------------------------------

  /**
   * Lo que costo esta pulsacion, en dolares.
   *
   * `numeric(10,5)` y no `real`: son pesos de la agencia y se van a sumar. Un
   * `real` acumulado sobre miles de filas deja de cuadrar, y una cuenta de
   * gasto que no cuadra no la usa nadie.
   *
   * Se calcula de los tokens que devuelve el proveedor en la propia respuesta,
   * no de una tabla de precios adivinada: si OpenAI cambia lo que cobra por una
   * imagen, los tokens siguen siendo los que fueron.
   */
  @ApiProperty({ example: 0.1818 })
  @Column({
    name: 'cost_usd',
    type: 'numeric',
    precision: 10,
    scale: 5,
    default: 0,
  })
  costUsd: string;

  @ApiProperty()
  @Column({ name: 'input_tokens', type: 'int', default: 0 })
  inputTokens: number;

  @ApiProperty()
  @Column({ name: 'output_tokens', type: 'int', default: 0 })
  outputTokens: number;

  // --- las dos versiones ----------------------------------------------------

  /**
   * Las claves y urls de la foto TAL Y COMO ESTABA antes de aplicar nada.
   *
   * Es la promesa de que el original nunca se pierde, y por eso se copia aqui
   * en vez de confiar en que los ficheros sigan donde estaban: mientras esta
   * fila exista, se sabe a que volver. `StorageService.remove` NUNCA se llama
   * sobre estas claves.
   */
  @ApiProperty()
  @Column({ name: 'original_snapshot', type: 'jsonb' })
  originalSnapshot: InstantaneaImagen;

  /**
   * La version retocada, ya guardada en disco con sus cuatro tamaños.
   *
   * Se guarda ANTES de que nadie decida: el asesor tiene que poder verla a
   * tamaño de ficha para decidir, y servirla desde `/media/` es la unica forma
   * de que la vea igual que la vera el visitante. Nula solo si el intento
   * fallo o si ya se descarto y se limpiaron los ficheros.
   */
  @ApiPropertyOptional({ nullable: true })
  @Column({ name: 'retouched_snapshot', type: 'jsonb', nullable: true })
  retouchedSnapshot: InstantaneaImagen | null;

  // --- quien decidio --------------------------------------------------------

  @ApiProperty({ enum: RetouchStatus })
  @Column({
    type: 'enum',
    enum: RetouchStatus,
    enumName: 'retouch_status_enum',
    default: RetouchStatus.PENDIENTE,
  })
  status: RetouchStatus;

  /**
   * Quien pulso el boton que costo el dinero. No sale del cuerpo de la
   * peticion sino del token, por lo mismo que la revision de privacidad: un
   * nombre que se puede escribir a mano no acredita nada.
   */
  @ApiProperty()
  @Column({ name: 'requested_by_agent_id', type: 'uuid' })
  requestedByAgentId: string;

  /**
   * Quien acepto o descarto. Es el dato que de verdad importa: aceptar es
   * publicar. Nulo mientras nadie haya mirado.
   */
  @ApiPropertyOptional({ nullable: true })
  @Column({ name: 'decided_by_agent_id', type: 'uuid', nullable: true })
  decidedByAgentId: string | null;

  @ApiPropertyOptional({ nullable: true })
  @Column({ name: 'decided_at', type: 'timestamptz', nullable: true })
  decidedAt: Date | null;

  /**
   * La confirmacion explicita de que quien lo pidio sabe que altera la
   * realidad. Solo se exige —y solo es cierta— fuera de `REVELADO`.
   *
   * Es lo que convierte "la herramienta lo permitio" en "una persona con nombre
   * dijo que si, sabiendo lo que hacia".
   */
  @ApiProperty()
  @Column({ name: 'alteracion_asumida', type: 'boolean', default: false })
  alteracionAsumida: boolean;

  /** Por que fallo, cuando fallo. */
  @ApiPropertyOptional({ nullable: true })
  @Column({ type: 'text', nullable: true })
  error: string | null;
}

/**
 * Una foto congelada: sus cuatro urls y su clave.
 *
 * Es una copia de campos que ya estan en `property_image`, y esa duplicidad es
 * el punto: `property_image` dice como esta la foto AHORA, y esto dice como
 * estaba. Si apuntaramos a la fila viva, aplicar un segundo retoque borraria la
 * unica referencia al original.
 */
export interface InstantaneaImagen {
  storageKey: string;
  url: string;
  urlMedium: string | null;
  urlLarge: string;
  urlOriginal: string;
  width: number | null;
  height: number | null;
  bytes: number | null;
  checksum: string | null;
}
