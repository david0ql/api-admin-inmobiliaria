import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

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
  @ApiProperty({ example: 'La alcoba salio muy oscura, sube la exposicion' })
  @IsString()
  @MinLength(3)
  @MaxLength(1000)
  instruction: string;

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
