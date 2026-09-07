import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsArray,
  IsBoolean,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';

/**
 * La mejora que se le pide a la IA cuando nadie escribe nada.
 *
 * No es un relleno: es LO QUE SE PIDE SIEMPRE. El panel manda esto en toda
 * peticion —con comentario o sin el— porque la pregunta que se hace quien abre
 * el dialogo no es "que quiero pedirle a un modelo", es "dejame esta foto lo
 * mejor que se pueda". Obligarle a redactar eso cada vez tenia dos finales
 * conocidos: o se escribia una frase distinta en cada foto —y entonces el
 * catalogo sale revelado de doce maneras— o se escribia lo primero que
 * viniera, que es peor que un texto pensado una vez.
 *
 * Pide TODO lo que se puede pedir sin dejar de ser una fotografia del
 * inmueble: exposicion, sombras, luces, balance de blancos, color, contraste,
 * nitidez, definicion y ruido. Y no pide nada mas, a proposito. La linea no es
 * "cuanto se mejora" sino "que se toca": todo lo de esta lista es una
 * propiedad de la FOTO, y ninguna es una propiedad de la CASA. Por eso se
 * puede aplicar a las 6.306 fotos del catalogo sin que ninguna prometa algo
 * que el comprador no vaya a encontrar cuando vaya.
 *
 * Que esta lista sea larga tampoco la hace agresiva: `encabezadoDocumental`
 * viaja delante y le prohibe al modelo añadir, quitar o mover cualquier cosa.
 * Esto dice como revelar; aquello dice que no se invente el inmueble.
 */
export const INSTRUCCION_POR_DEFECTO = [
  'Revela esta fotografia de inmueble como lo haria un fotografo profesional de arquitectura.',
  'Corrige la exposicion y el rango dinamico: abre las sombras hasta que se lea lo que hay en ellas y contiene las zonas mas claras sin dejarlas planas.',
  'Neutraliza el balance de blancos y la dominante de color: las paredes blancas tienen que salir blancas, no amarillentas ni azuladas.',
  'Da contraste y cuerpo al color sin exagerar la saturacion.',
  'Mejora la nitidez y la definicion del detalle real, y reduce el ruido y el grano de la camara.',
  'Deja una imagen nitida, bien definida y bien revelada, con la calidad que se espera en un anuncio inmobiliario.',
  'Todo lo anterior es revelado fotografico: no cambies absolutamente nada de lo que aparece en la escena.',
].join(' ');

/**
 * Lo que se le manda al modelo: la mejora de siempre, mas lo que se haya
 * escrito.
 *
 * Vive aqui y en un solo sitio porque el panel tambien necesita saber el texto
 * —lo enseña antes de cobrar— y dos copias del mismo texto en dos repositorios
 * es exactamente la clase de contrato que se rompe sin dar error: se afina la
 * frase en la API, el panel sigue enseñando la vieja, y nadie se entera hasta
 * que alguien compara. El panel no compone nada; pregunta.
 *
 * El comentario va DETRAS y no delante: lo ultimo que lee un modelo pesa mas,
 * y lo que alguien se molesto en escribir sobre esta foto concreta tiene que
 * pesar mas que el texto que se manda en todas.
 *
 * La clasificacion se hace luego sobre el resultado de esto, no sobre el
 * comentario suelto, que es lo correcto: lo que hay que juzgar es lo que se
 * envia. Y como la frontera clasifica hacia arriba, un comentario que altere
 * la escena sigue mandando sobre el revelado de la base.
 */
export function componerInstruccion(comentario?: string | null): string {
  const extra = (comentario ?? '').trim();
  return extra
    ? `${INSTRUCCION_POR_DEFECTO} Ademas, para esta foto en concreto: ${extra}`
    : INSTRUCCION_POR_DEFECTO;
}

export class RetouchPreviewDto {
  /*
    Opcional, y esa es la diferencia que importa.

    Antes exigia tres caracteres, asi que la pantalla no podia preguntar "¿que
    va a pasar si no escribo nada?" — y como esa es justo la peticion mas
    frecuente, el caso mas comun era el unico que se lanzaba a ciegas: sin
    coste a la vista y sin saber si lo que se iba a mandar alteraba algo.
  */
  @ApiPropertyOptional({
    example: 'Quita los cables de la calle y pon cielo azul',
    description:
      'Lo que se añade a la mejora de siempre. Sin esto se previsualiza la mejora sola.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  instruction?: string;
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
  @ApiPropertyOptional({
    example: 'La alcoba salio muy oscura, sube la exposicion',
    description:
      'Sin esto se hace un revelado conservador, que es el unico retoque que no altera lo que hay',
  })
  @IsOptional()
  @IsString()
  @MinLength(3)
  @MaxLength(1000)
  instruction?: string;

  /**
   * Las propuestas de las que sale esta peticion, si vino de ahi.
   *
   * Se guardan como referencia y no deciden nada por si solas: lo que se le
   * manda al modelo es texto, y ese texto es el que se clasifica. Una propuesta
   * no puede saltarse la frontera por venir de otro modulo.
   */
  @ApiPropertyOptional({ type: [String], format: 'uuid' })
  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true })
  sugerenciaIds?: string[];

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
