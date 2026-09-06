import { ApiPropertyOptional } from '@nestjs/swagger';
import {
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
