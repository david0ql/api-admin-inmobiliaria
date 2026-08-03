import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';

/**
 * Un turno del hilo tal y como lo envia el navegador.
 *
 * Solo se aceptan mensajes de `user` y `assistant`, y solo su texto: los
 * resultados de herramientas NO se aceptan del cliente. El hilo es efimero
 * —no se guarda nada en el servidor—, asi que el cliente carga el historial y
 * lo reenvia cada turno; pero las herramientas se ejecutan de nuevo aqui, con
 * datos frescos de la base, para que nadie pueda inyectar un "resultado" falso
 * y hacer que el asistente afirme algo que no esta en el inventario.
 */
export class ChatTurnDto {
  @ApiProperty({ enum: ['user', 'assistant'] })
  @IsIn(['user', 'assistant'])
  role: 'user' | 'assistant';

  @ApiProperty()
  @IsString()
  @MaxLength(4000)
  content: string;
}

export class ChatDto {
  @ApiProperty({
    enum: ['GLOBAL', 'PROPERTY'],
    description:
      'GLOBAL: chat del sitio, puede buscar. PROPERTY: atado al inmueble de `code`.',
  })
  @IsIn(['GLOBAL', 'PROPERTY'])
  scope: 'GLOBAL' | 'PROPERTY';

  @ApiPropertyOptional({
    description: 'Código del inmueble, obligatorio cuando scope es PROPERTY.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(32)
  code?: string;

  /**
   * Los inmuebles que el visitante ya ha visto en este hilo.
   *
   * Solo CODIGOS, nunca datos: el servidor los relee de la base antes de cada
   * respuesta. Aunque alguien manipule esta lista, lo unico que consigue es que
   * el asistente hable de otros inmuebles publicados — no puede colar un precio
   * ni un dato falso, porque el dato no viaja por aqui.
   *
   * Hace falta porque el hilo es efimero y los mensajes anteriores del
   * asistente son prosa: no llevan identificadores, asi que sin esto no puede
   * volver a consultar aquello de lo que ya hablo.
   */
  /*
    El tope es holgado a proposito y el servidor se queda con los ultimos.

    Con un limite ajustado, una conversacion normal —mira casas, luego
    apartamentos, luego lotes— lo pasaba y el chat dejaba de responder entero
    con un 400. Rechazar la peticion por traer historial de mas es convertir un
    dato accesorio en un fallo total; recortarlo no le cuesta nada a nadie.
  */
  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(200)
  @IsString({ each: true })
  @MaxLength(32, { each: true })
  shownCodes?: string[];

  /**
   * Las visitas que este visitante pidio en este hilo.
   *
   * Es lo que le permite cambiarlas: el id se lo dimos al agendar, asi que
   * tenerlo es la prueba de que la visita es suya. Por telefono no valdria —
   * cualquiera que se sepa un numero podria mover la visita de otro.
   */
  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @MaxLength(64, { each: true })
  bookedIds?: string[];

  @ApiProperty({ type: [ChatTurnDto] })
  @IsArray()
  @ArrayMaxSize(80)
  @ValidateNested({ each: true })
  @Type(() => ChatTurnDto)
  messages: ChatTurnDto[];
}
