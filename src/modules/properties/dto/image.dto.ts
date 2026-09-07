import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsEnum,
  IsOptional,
  IsString,
  Length,
  ValidateIf,
} from 'class-validator';
import { ImageKind } from '../../media/image-asset.entity';

/**
 * Que se esta subiendo.
 *
 * Viaja como campo de texto del mismo `multipart` que las imagenes: quien
 * arrastra tres planos al recuadro de planos no tiene que marcarlos uno a uno
 * despues. Si no se dice nada es una foto, que es lo que se sube el 95% de las
 * veces.
 */
export class UploadImagesDto {
  @ApiPropertyOptional({ enum: ImageKind, default: ImageKind.PHOTO })
  @IsOptional()
  @IsEnum(ImageKind)
  kind?: ImageKind;
}

/** Lo unico editable de una imagen ya subida: su pie y si es plano o foto. */
export class UpdateImageDto {
  @ApiPropertyOptional({
    nullable: true,
    description: 'Pie de foto; null lo borra',
  })
  @IsOptional()
  // `null` es un valor con significado —quitar el pie— y no una ausencia, asi
  // que se acepta explicitamente en lugar de rechazarlo como texto invalido.
  @ValidateIf((_, value) => value !== null)
  @IsString()
  @Length(1, 300)
  description?: string | null;

  @ApiPropertyOptional({ enum: ImageKind })
  @IsOptional()
  @IsEnum(ImageKind)
  kind?: ImageKind;
}

/**
 * Revelar la foto o dejarla como salio de la camara.
 *
 * Un solo interruptor y no un juego de mandos: quien mira la foto en el panel
 * no sabe —ni tiene por que— cuanta ganancia lleva, sabe si le gusta mas asi o
 * como estaba. Los numeros los decide el codigo midiendo, y ajustarlos a mano
 * foto a foto seria retoque, que es otro camino y cuesta dinero.
 */
export class DevelopImageDto {
  @ApiProperty({
    description:
      'true vuelve a revelar con el criterio actual; false deja la foto sin revelar',
  })
  @IsBoolean()
  aplicar: boolean;
}
