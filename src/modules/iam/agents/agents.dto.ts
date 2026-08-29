import {
  ApiProperty,
  ApiPropertyOptional,
  PartialType,
  OmitType,
} from '@nestjs/swagger';
import {
  IsBoolean,
  IsEmail,
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  MinLength,
} from 'class-validator';
import { AgentStatus, Role } from '../domain/role.enum';

export class CreateAgentDto {
  @ApiProperty()
  @IsString()
  @Length(1, 120)
  firstName: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(1, 120)
  lastName?: string;

  @ApiProperty()
  @IsEmail()
  email: string;

  @ApiPropertyOptional({
    description: 'Si se omite, el asesor debera establecerla al primer acceso',
  })
  @IsOptional()
  @IsString()
  @MinLength(8)
  password?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(6, 32)
  cellPhone?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  hasWhatsapp?: boolean;

  /**
   * La foto de perfil, siempre alojada aqui.
   *
   * Solo se admiten rutas de `/media/`: las que devuelve `POST
   * /agents/:id/photo`. Un `IsUrl` a secas dejaria apuntar el avatar a
   * cualquier servidor ajeno, que es exactamente de donde la importacion tuvo
   * que traerselas —images.wasi.co— y de paso un pixel espia de regalo en
   * cada pantalla del panel.
   *
   * `null` borra la foto y deja las iniciales.
   */
  @ApiPropertyOptional({ example: '/media/agents/uuid-t.webp', nullable: true })
  @IsOptional()
  @Matches(/^\/media\/[\w./-]+$/, {
    message: 'La foto debe subirse desde el panel, no enlazarse de fuera',
  })
  photoUrl?: string | null;

  @ApiPropertyOptional({ enum: Role, default: Role.AGENT })
  @IsOptional()
  @IsEnum(Role)
  role?: Role;

  /**
   * La sede a la que pertenece.
   *
   * Opcional en el DTO y no en el dominio: quien crea desde una sede no la
   * manda —se le impone la suya— y ADMIN y DIRECTOR no tienen ninguna. Quien
   * decide de verdad es el servicio.
   */
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  branchId?: string;
}

export class UpdateAgentDto extends PartialType(
  OmitType(CreateAgentDto, ['password'] as const),
) {
  @ApiPropertyOptional({ enum: AgentStatus })
  @IsOptional()
  @IsEnum(AgentStatus)
  status?: AgentStatus;
}

export class SetPasswordDto {
  @ApiProperty({ minLength: 8 })
  @IsString()
  @MinLength(8)
  password: string;
}
