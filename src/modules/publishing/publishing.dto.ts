import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUrl,
  Length,
} from 'class-validator';
import { PublicationState } from './domain/property-publication.entity';

export class SetPublicationsDto {
  @ApiProperty({
    type: [Number],
    description: 'Portales donde debe estar el inmueble',
  })
  @IsArray()
  @ArrayMaxSize(50)
  @Type(() => Number)
  @IsInt({ each: true })
  portalIds: number[];
}

export class UpdatePublicationDto {
  @ApiPropertyOptional({ enum: PublicationState })
  @IsOptional()
  @IsEnum(PublicationState)
  state?: PublicationState;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(0, 300)
  note?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUrl()
  externalUrl?: string;
}
