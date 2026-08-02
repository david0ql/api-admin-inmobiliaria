import { ApiProperty, ApiPropertyOptional, OmitType } from '@nestjs/swagger';
import { CreateConsignmentDto } from '../../public/dto/consignment.dto';
import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsEmail,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

/**
 * Politica de contrasena del portal.
 *
 * Doce caracteres y sin exigir simbolos: la longitud es lo que aguanta un
 * ataque por diccionario, y las reglas de "una mayuscula y un numero" solo
 * producen `Password1`. El tope de 128 no es cosmetico — argon2 sobre una
 * entrada arbitrariamente larga es una denegacion de servicio gratis.
 */
const MIN_PASSWORD = 12;
const MAX_PASSWORD = 128;

const PASSWORD_MESSAGE = `La contraseña debe tener al menos ${MIN_PASSWORD} caracteres`;

class PasswordField {
  @ApiProperty({ minLength: MIN_PASSWORD, maxLength: MAX_PASSWORD })
  @IsString()
  @MinLength(MIN_PASSWORD, { message: PASSWORD_MESSAGE })
  @MaxLength(MAX_PASSWORD)
  password: string;
}

export class RegisterPortalDto extends PasswordField {
  @ApiProperty()
  @IsString()
  @Length(2, 160)
  firstName: string;

  @ApiProperty()
  @IsString()
  @Length(2, 160)
  lastName: string;

  @ApiProperty()
  @IsEmail()
  @MaxLength(180)
  @Transform(({ value }) => String(value).trim().toLowerCase())
  email: string;

  @ApiProperty({ example: '3001234567' })
  @IsString()
  @Length(7, 40)
  @Matches(/^[\d\s+()-]+$/, { message: 'El teléfono solo admite dígitos' })
  cellPhone: string;

  @ApiPropertyOptional({ description: 'Cédula o NIT' })
  @IsOptional()
  @IsString()
  @Length(4, 40)
  identification?: string;

  @ApiPropertyOptional({ description: 'Id de ciudad del catálogo' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  cityId?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  acceptsMarketing?: boolean;

  @ApiPropertyOptional({ description: 'Token del captcha de la web pública' })
  @IsOptional()
  @IsString()
  captchaToken?: string;
}

export class LoginPortalDto {
  @ApiProperty()
  @IsEmail()
  @MaxLength(180)
  email: string;

  /*
   * En el login NO se aplica la politica de longitud: rechazar por corta una
   * contrasena existente delataria que no cumple la actual. Solo se acota el
   * maximo, por el coste de argon2.
   */
  @ApiProperty()
  @IsString()
  @MaxLength(MAX_PASSWORD)
  password: string;

  @ApiPropertyOptional({ description: 'Token del captcha de la web pública' })
  @IsOptional()
  @IsString()
  captchaToken?: string;
}

export class ChangePortalPasswordDto extends PasswordField {
  @ApiProperty()
  @IsString()
  @MaxLength(MAX_PASSWORD)
  currentPassword: string;
}

/** Lo que el panel envía para dar o quitar acceso a un cliente. */
export class PortalAccessDto {
  @ApiPropertyOptional({
    description:
      'Clave inicial. El cliente tendrá que cambiarla en su primera entrada.',
    minLength: MIN_PASSWORD,
  })
  @IsOptional()
  @IsString()
  @MinLength(MIN_PASSWORD, { message: PASSWORD_MESSAGE })
  @MaxLength(MAX_PASSWORD)
  password?: string;

  @ApiPropertyOptional({ description: 'Habilita o revoca el acceso' })
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;
}

/**
 * Consignar desde el portal.
 *
 * Es el formulario publico MENOS los datos del propietario: quien esta dentro
 * ya esta identificado, y la API los toma de la sesion. Omitirlos del DTO y no
 * solo ignorarlos en el controlador es lo que hace que la garantia sea real —
 * con `forbidNonWhitelisted`, mandarlos es un 400, no un intento silencioso de
 * consignar a nombre de otro.
 */
export class PortalConsignmentDto extends OmitType(CreateConsignmentDto, [
  'ownerFirstName',
  'ownerLastName',
  'ownerEmail',
  'ownerPhone',
  'captchaToken',
] as const) {}
