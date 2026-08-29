import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsUUID,
  Matches,
  Max,
  Min,
} from 'class-validator';
import { AttendanceMarkType } from './domain/attendance-mark.entity';

/**
 * Lo que manda el boton "ya entré" / "ya me voy".
 *
 * No lleva —ni puede llevar— a quien pertenece la marca: quien ficha sale
 * siempre del token. Ademas el `ValidationPipe` global va con
 * `forbidNonWhitelisted`, asi que colar un `agentId` en el cuerpo no es que se
 * ignore: la peticion se rechaza.
 */
export class CreateAttendanceMarkDto {
  @ApiProperty({ enum: AttendanceMarkType })
  @IsEnum(AttendanceMarkType, {
    message: 'El tipo de marca debe ser IN (entrada) u OUT (salida)',
  })
  type: AttendanceMarkType;

  /*
    Las coordenadas son obligatorias y no tienen valor por defecto. Un fichaje
    sin sitio no prueba nada, y admitir marcas sin ubicacion "cuando el GPS
    falle" convierte la excepcion en la norma a la semana siguiente: quien no
    quiera dar el permiso lo dejaria apagado para siempre.
  */
  @ApiProperty({ example: 7.119349, minimum: -90, maximum: 90 })
  @Type(() => Number)
  @IsNumber(
    { allowNaN: false, allowInfinity: false },
    { message: 'Necesitamos tu ubicación: falta la latitud' },
  )
  latitude: number;

  /*
    El rango no se comprueba aqui sino en el servicio: `@Min`/`@Max` tambien
    saltan cuando el campo no viene, y quien se dejo el GPS apagado recibia
    tres mensajes contradictorios en vez del que necesita leer.
  */
  @ApiProperty({ example: -73.122741, minimum: -180, maximum: 180 })
  @Type(() => Number)
  @IsNumber(
    { allowNaN: false, allowInfinity: false },
    { message: 'Necesitamos tu ubicación: falta la longitud' },
  )
  longitude: number;

  /** Lo que el navegador dice que se fia de esas coordenadas, en metros. */
  @ApiPropertyOptional({ example: 18, minimum: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ allowNaN: false, allowInfinity: false })
  @Min(0)
  @Max(100_000)
  accuracyM?: number;
}

/**
 * Rango de fechas del historial.
 *
 * Son fechas de calendario en Bogota —"2026-08-28"— y no instantes: quien
 * pregunta por agosto quiere agosto tal y como lo vivio la oficina, no una
 * ventana UTC que empieza a las siete de la tarde del dia anterior.
 */
export class AttendanceRangeDto {
  @ApiPropertyOptional({
    example: '2026-08-01',
    description: 'Por defecto, 29 días atrás',
  })
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'La fecha «desde» debe venir como AAAA-MM-DD',
  })
  from?: string;

  @ApiPropertyOptional({
    example: '2026-08-31',
    description: 'Por defecto, hoy',
  })
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'La fecha «hasta» debe venir como AAAA-MM-DD',
  })
  to?: string;
}

/** El historial del panel: el mismo rango, mas el filtro por persona. */
export class AttendanceHistoryDto extends AttendanceRangeDto {
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID('4', { message: 'El filtro por persona espera el id de un asesor' })
  agentId?: string;

  /** Tope de marcas devueltas; corta rangos absurdos, no pagina. */
  @ApiPropertyOptional({ minimum: 1, maximum: 20_000, default: 5_000 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(20_000)
  limit?: number;
}
