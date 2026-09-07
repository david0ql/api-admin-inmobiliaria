import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsArray,
  IsBoolean,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';

/**
 * El retoque que se hace cuando nadie dice que quiere.
 *
 * El panel manda la peticion sin texto, asi que hay que tener una respuesta a
 * "retoca esta foto" a secas. Es deliberadamente el subconjunto seguro: luz,
 * color y contraste, sin tocar nada de lo que hay. Un valor por defecto que
 * pudiera cambiar la escena convertiria ese boton en una alteracion silenciosa,
 * que es justo lo que este modulo existe para que no pase.
 */
export const INSTRUCCION_POR_DEFECTO =
  'Ajusta la exposicion, el contraste y el balance de blancos de esta fotografia de inmueble. No cambies nada de lo que aparece en ella.';

export class RetouchPreviewDto {
  @ApiProperty({ example: 'Quita los cables de la calle y pon cielo azul' })
  @IsString()
  @MinLength(3)
  @MaxLength(1000)
  instruction: string;
}

export class RetouchDto {
  /**
   * Lo que se quiere. En castellano y a mano, no una lista de botones.
   *
   * Se penso en cerrar el vocabulario a un enum de acciones —seria mas facil de
   * clasificar— y se descarto: un menu cerrado convierte "quitar la humedad del
   * techo" en un boton oficial de la agencia, y no queremos ofrecerlo, queremos
   * poder reconocerlo cuando alguien lo escriba. Con texto libre el asesor pide
   * lo que necesita y nosotros clasificamos lo que pidio.
   */
  @ApiPropertyOptional({
    example: 'La alcoba salio muy oscura, sube la exposicion',
    description:
      'Sin esto se hace un revelado conservador, que es el unico retoque que no altera lo que hay',
  })
  @IsOptional()
  @IsString()
  @MinLength(3)
  @MaxLength(1000)
  instruction?: string;

  /**
   * Las propuestas de las que sale esta peticion, si vino de ahi.
   *
   * Se guardan como referencia y no deciden nada por si solas: lo que se le
   * manda al modelo es texto, y ese texto es el que se clasifica. Una propuesta
   * no puede saltarse la frontera por venir de otro modulo.
   */
  @ApiPropertyOptional({ type: [String], format: 'uuid' })
  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true })
  sugerenciaIds?: string[];

  /**
   * "Se que esto va a hacer que la foto deje de mostrar el inmueble como es."
   *
   * Solo hace falta cuando la instruccion no es un revelado, y no es un tramite:
   * es el campo que convierte "la herramienta me dejo" en una persona con
   * nombre que dijo que si. Queda guardado en la fila junto a quien lo pulso.
   *
   * No viene de un desplegable ni tiene valor por defecto cierto a proposito.
   */
  @ApiPropertyOptional({
    default: false,
    description:
      'Obligatorio si la instruccion altera la escena: confirma que se asume',
  })
  @IsOptional()
  @IsBoolean()
  alteracionAsumida?: boolean;
}
