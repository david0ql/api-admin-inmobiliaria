import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ChatIssue } from '../domain/chat.enums';
import { LOCALES, type Locale } from '../../i18n/domain/translation.entity';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsBoolean,
  IsEmail,
  IsEnum,
  IsInt,
  Matches,
  MinLength,
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

  /**
   * La conversacion abierta al identificarse. Es donde se guarda el hilo para
   * poder revisarlo despues.
   */
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(64)
  conversationId?: string;

  /** Para saludarle por su nombre sin tener que ir a buscarlo. */
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(80)
  visitorName?: string;

  /**
   * El idioma en el que esta leyendo la web.
   *
   * Lo dice la URL del visitante —la raiz es español, `/en` es ingles—, asi que
   * viaja en cada turno en lugar de deducirse aqui: el navegador puede estar en
   * un idioma y la pagina abierta en el otro, y quien lee en ingles espera que
   * el chat le conteste en ingles.
   *
   * Opcional y con español por defecto: un cliente viejo que no lo mande sigue
   * funcionando exactamente igual que antes.
   */
  @ApiPropertyOptional({ enum: LOCALES, default: 'es' })
  @IsOptional()
  @IsIn(LOCALES)
  locale?: Locale;

  @ApiProperty({ type: [ChatTurnDto] })
  @IsArray()
  @ArrayMaxSize(80)
  @ValidateNested({ each: true })
  @Type(() => ChatTurnDto)
  messages: ChatTurnDto[];
}

/**
 * Quien va a escribir en el chat.
 *
 * Se pide ANTES de la primera pregunta. Es fricción, si: pero un chat anonimo
 * deja al equipo con una conversacion interesante y nadie a quien llamar, y
 * este chat existe para traer clientes, no para responder curiosidades.
 */
export class IdentifyDto {
  @ApiProperty()
  @IsString()
  @MinLength(2, { message: 'Escribe tu nombre.' })
  @MaxLength(80)
  firstName: string;

  @ApiProperty()
  @IsString()
  @MinLength(2, { message: 'Escribe tus apellidos.' })
  @MaxLength(80)
  lastName: string;

  /** Con indicativo de pais: `+57 300 123 4567`. */
  @ApiProperty()
  @IsString()
  @Matches(/^\+?\d[\d\s()-]{6,19}$/, {
    message: 'El telefono no parece valido.',
  })
  phone: string;

  @ApiProperty()
  @IsEmail({}, { message: 'Ese correo no parece valido.' })
  @MaxLength(160)
  email: string;

  /** Si el chat se abre desde una ficha, para saber por que inmueble pregunta. */
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(32)
  propertyCode?: string;
}

export class CreateReviewDto {
  /** La respuesta concreta que se califica. */
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  messageId?: string;

  @ApiProperty({ enum: ChatIssue, isArray: true })
  @IsArray()
  @ArrayMinSize(1, { message: 'Marca al menos que fue lo que fallo.' })
  @IsEnum(ChatIssue, { each: true })
  issues: ChatIssue[];

  /**
   * Obligatorio. Marcar "tono robotico" y nada mas no sirve para corregir: lo
   * que hace falta es que habria estado bien, y eso solo lo sabe quien lo leyo.
   */
  @ApiProperty()
  @IsString()
  @MinLength(10, {
    message: 'Cuentanos que habria estado bien (10 caracteres minimo).',
  })
  @MaxLength(2000)
  comment: string;
}

export class ApplyRuleDto {
  /** El texto final. Si no viene, se aplica la propuesta tal cual. */
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(240)
  text?: string;
}

export class CreateRuleDto {
  @ApiProperty()
  @IsString()
  @MinLength(5)
  @MaxLength(240)
  text: string;
}

export class UpdateRuleDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(5)
  @MaxLength(240)
  text?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  active?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  position?: number;
}

export class PostPromptDto {
  @ApiProperty()
  @IsString()
  @MaxLength(4000)
  postPrompt: string;
}
