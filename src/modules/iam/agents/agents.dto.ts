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
  IsUrl,
  Length,
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

  @ApiPropertyOptional()
  @IsOptional()
  @IsUrl()
  photoUrl?: string;

  @ApiPropertyOptional({ enum: Role, default: Role.AGENT })
  @IsOptional()
  @IsEnum(Role)
  role?: Role;
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
