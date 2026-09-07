import { RetouchKind } from './domain/image-retouch.enums';

/**
 * Donde acaba revelar y empieza falsear.
 *
 * Esto no es un filtro de seguridad y no pretende serlo: se puede rodear
 * escribiendo la peticion de otra forma, y quien la escribe es un compañero de
 * la agencia, no un atacante. Lo que hace es que NADIE altere la realidad de un
 * inmueble por descuido — que es como pasa de verdad. El asesor que escribe
 * "ponle un cielo azul" no esta planeando un fraude: esta arreglando una foto
 * fea un viernes por la tarde, y no ha pensado que el comprador va a ir a esa
 * casa y va a mirar hacia arriba.
 *
 * La clasificacion se hace con lexico y no preguntandole a un modelo, por tres
 * razones: es gratis, es la misma respuesta siempre —y una frontera que cambia
 * de opinion entre dos pulsaciones no es una frontera— y se puede leer, discutir
 * y corregir en una revision de codigo. Un juicio que decide si una foto queda
 * marcada como alterada tiene que ser auditable.
 *
 * Ante la duda se clasifica HACIA ARRIBA. Marcar de mas cuesta una casilla de
 * confirmacion; marcar de menos cuesta un anuncio que enseña algo que no
 * existe.
 */

/** Sin tildes y en minusculas: nadie escribe "diafragma" igual dos veces. */
function normalizar(texto: string): string {
  return texto
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Defectos del inmueble. Taparlos no es maquillar: es esconder a quien compra
 * algo que le va a costar dinero arreglar.
 */
const DEFECTOS = [
  'humedad',
  'humedades',
  'moho',
  'hongo',
  'hongos',
  'grieta',
  'grietas',
  'fisura',
  'fisuras',
  'filtracion',
  'filtraciones',
  'gotera',
  'goteras',
  'oxido',
  'oxidado',
  'corrosion',
  'salitre',
  'desconchado',
  'descascarado',
  'deterioro',
  'agrietado',
  'mancha',
  'manchas',
  'mancha de agua',
  'pintura saltada',
  'comejen',
  'termitas',
];

/**
 * Cosas del mundo. Cambiarlas cambia lo que el anuncio promete.
 *
 * El cielo esta aqui y no en la lista de color a proposito: subirle el contraste
 * a un cielo nublado sigue siendo un cielo nublado, pero "ponle un cielo azul"
 * es prometer un clima. En Bucaramanga llueve, y la foto no decide eso.
 */
const CONTENIDO = [
  'cielo',
  'cielos',
  'nube',
  'nubes',
  'nublado',
  'sol',
  'soleado',
  'cable',
  'cables',
  'cableado',
  'tendido',
  'poste',
  'postes',
  'antena',
  'antenas',
  'basura',
  'escombro',
  'escombros',
  'carro',
  'carros',
  'vehiculo',
  'vehiculos',
  'moto',
  'motos',
  'persona',
  'personas',
  'gente',
  'señor',
  'señora',
  'niño',
  'ropa tendida',
  'tendedero',
  'reja',
  'rejas',
  'mueble',
  'muebles',
  'sofa',
  'cama',
  'mesa',
  'silla',
  'sillas',
  'nevera',
  'electrodomestico',
  'cuadro',
  'cuadros',
  'planta',
  'plantas',
  'matera',
  'cesped',
  'pasto',
  'jardin',
  'arbol',
  'arboles',
  'piscina',
  'letrero',
  'aviso',
  'rotulo',
  'logo',
  'marca de agua',
  'vecino',
  'edificio de al lado',
  'perro',
  'gato',
  'mascota',
];

/**
 * Lo que SI es revelar: propiedades de la fotografia, no de la casa.
 *
 * `ruido`, `grano` y `reflejo` viven aqui aunque se "quiten": lo que se quita
 * es un defecto de la camara, no algo que estuviera en la habitacion.
 */
const REVELADO = [
  'luz',
  'luminosidad',
  'brillo',
  'exposicion',
  'expuesta',
  'subexpuesta',
  'sobreexpuesta',
  'quemada',
  'quemadas',
  'oscura',
  'oscuro',
  'sombra',
  'sombras',
  'contraste',
  'balance de blancos',
  'temperatura de color',
  'color',
  'colores',
  'tono',
  'tonos',
  'saturacion',
  'dominante',
  'amarillenta',
  'verdosa',
  'azulada',
  'nitidez',
  'enfoque',
  'enfocar',
  'definicion',
  'ruido',
  'grano',
  'pixelada',
  'borrosa',
  'enderezar',
  'nivelar',
  'torcida',
  'horizonte',
  'perspectiva',
  'encuadre',
  'recortar',
  'recorte',
  'rango dinamico',
  'revelado',
  'revelar',
];

/**
 * Verbos que cambian la escena, por su RAIZ y no por su forma.
 *
 * Existe porque el castellano se conjuga y nadie escribe en infinitivo. La
 * primera version de este fichero listaba "limpiar", "pintar" y "amueblar", y
 * dejaba pasar "limpia la cocina", "pinta la fachada" y "amuebla la sala" — que
 * es exactamente como se escribe de verdad. Se detecto en las pruebas, no en
 * produccion, que es donde hay que detectarlo.
 */
const CONTENIDO_RAICES = [
  'amuebl',
  'amobl',
  'decor',
  'vaci',
  'despej',
  'desocup',
  'orden',
  'limpi',
  'pint',
  'renov',
  'remodel',
  'reform',
  'moderniz',
  'restaur',
];

/** Lo mismo para los verbos genericos de añadir y quitar. */
const VERBOS_RAICES = [
  'quit',
  'borr',
  'elimin',
  'remov',
  'sac',
  'escond',
  'ocult',
  'tap',
  'disimul',
  'anad',
  'agreg',
  'pon',
  'coloc',
  'sustitu',
  'reemplaz',
  'cambi',
  'conviert',
  'convert',
  'transform',
];

/** Busca terminos y devuelve los que aparecen, para poder explicar el veredicto. */
function encontrados(texto: string, terminos: string[]): string[] {
  const hallados: string[] = [];
  for (const termino of terminos) {
    // Frontera de palabra a los lados: "sol" no puede casar dentro de "solo",
    // ni "cama" dentro de "camara" — que es justo la palabra que mas va a
    // aparecer en una instruccion sobre fotografia.
    const patron = new RegExp(
      `(^|[^a-z0-9ñ])${termino.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^a-z0-9ñ]|$)`,
    );
    if (patron.test(texto)) hallados.push(termino);
  }
  return hallados;
}

/**
 * Igual que `encontrados`, pero por el principio de la palabra: la raiz mas
 * cualquier terminacion. `limpi` caza "limpia", "limpiar" y "limpieza".
 *
 * El tope de siete letras de terminacion no es capricho: sin el, `pon` cazaria
 * cualquier palabra larga que empiece por "pon", y una raiz de tres letras que
 * casa con media lengua deja de ser una frontera.
 */
function encontradosPorRaiz(texto: string, raices: string[]): string[] {
  const hallados: string[] = [];
  for (const raiz of raices) {
    const patron = new RegExp(`(^|[^a-z0-9ñ])${raiz}[a-zñ]{0,7}([^a-z0-9ñ]|$)`);
    if (patron.test(texto)) hallados.push(raiz);
  }
  return hallados;
}

/**
 * Zonas de las que NO hay informacion que recuperar.
 *
 * Pedir "recupera el detalle de las ventanas quemadas" suena a revelado y por
 * intencion lo es: nadie esta tratando de engañar. Pero en una zona quemada no
 * quedan datos, y un modelo generativo no recupera lo que no hay — lo INVENTA.
 *
 * Esta medido sobre una sala real del catalogo: al pedirle recuperar unas
 * ventanas quemadas, el modelo borro la cenefa decorativa tallada que remataba
 * el ventanal y la sustituyo por un riel de persiana liso, y dibujo una vista
 * de la ciudad distinta de la que habia. La foto quedo mejor expuesta y con un
 * acabado del inmueble que no existe.
 *
 * No se sube de categoria —seguiria siendo un revelado por intencion, y pedir
 * confirmacion por subir la luz acabaria con la gente marcando la casilla sin
 * leerla— pero se avisa. Que quien mire el resultado sepa exactamente donde
 * tiene que mirar.
 */
const RECONSTRUCCION = [
  'quemada',
  'quemadas',
  'quemado',
  'quemados',
  'sobreexpuesta',
  'sobreexpuesto',
  'recupera',
  'recuperar',
  'reconstruye',
  'reconstruir',
  'detalle perdido',
  'subexpuesta',
  'negros',
];

export interface Veredicto {
  kind: RetouchKind;
  /** Que palabras lo decidieron. Se guarda: dentro de un año explica el porque. */
  motivos: string[];
  /** Lo que hay que enseñarle a quien pulsa, en su idioma. */
  advertencia: string | null;
}

/**
 * Clasifica lo que se le pide a la IA sobre una foto de inmueble.
 *
 * El orden importa y es de mayor a menor gravedad: una instruccion que dice
 * "sube la luz y quita la humedad del techo" es OCULTA_DEFECTO, no REVELADO,
 * aunque lo primero que pida sea legitimo. Lo grave manda.
 */
export function clasificarInstruccion(instruccion: string): Veredicto {
  const texto = normalizar(instruccion);

  const defectos = encontrados(texto, DEFECTOS);
  if (defectos.length) {
    return {
      kind: RetouchKind.OCULTA_DEFECTO,
      motivos: defectos,
      advertencia:
        'Lo que se pide taparia un defecto del inmueble (' +
        defectos.join(', ') +
        '). Quien compra tiene derecho a verlo antes de la visita, y el vendedor responde por los vicios que oculta. Si el defecto ya se reparo, la salida honesta es una foto nueva, no borrarlo de la vieja.',
    };
  }

  const contenido = [
    ...encontrados(texto, CONTENIDO),
    ...encontradosPorRaiz(texto, CONTENIDO_RAICES),
  ];
  if (contenido.length) {
    return {
      kind: RetouchKind.ALTERACION,
      motivos: contenido,
      advertencia:
        'Lo que se pide cambia lo que hay en la escena (' +
        contenido.join(', ') +
        '), no como esta fotografiada. El comprador va a visitar el inmueble y va a ver lo que hay de verdad.',
    };
  }

  const revelado = encontrados(texto, REVELADO);
  const verbos = encontradosPorRaiz(texto, VERBOS_RAICES);

  // Un verbo de añadir o quitar sin nada de revelado alrededor: no se sabe que
  // se quita, y no saberlo es motivo suficiente para marcarlo. Es la unica
  // rama que clasifica por lo que NO dice, y es deliberada: "quitale lo feo"
  // se escribe mas de lo que parece.
  if (verbos.length && !revelado.length) {
    return {
      kind: RetouchKind.ALTERACION,
      motivos: verbos,
      advertencia:
        'La instruccion pide añadir o quitar algo ("' +
        verbos.join('", "') +
        '") sin decir que es algo del revelado. Se trata como una alteracion de la escena. Si solo se queria corregir luz o color, conviene escribirlo asi.',
    };
  }

  /*
    Un revelado que pide recuperar lo que se quemo o lo que se fue a negro. Se
    deja pasar sin confirmacion —la intencion es legitima— pero con el aviso
    puesto: ahi no hay nada que recuperar y el modelo va a rellenarlo.
  */
  const reconstruccion = encontrados(texto, RECONSTRUCCION);
  if (reconstruccion.length) {
    return {
      kind: RetouchKind.REVELADO,
      motivos: [...revelado, ...reconstruccion],
      advertencia:
        'Ojo: en una zona quemada o completamente oscura no queda informacion que recuperar, asi que el modelo va a INVENTARSE lo que hay ahi. En una prueba real sustituyo la cenefa tallada de un ventanal por un riel de persiana liso. Mira esa zona con calma antes de aceptar.',
    };
  }

  return { kind: RetouchKind.REVELADO, motivos: revelado, advertencia: null };
}

/**
 * Las instrucciones que van SIEMPRE delante de lo que escribe el asesor.
 *
 * Existen porque `gpt-image-2` no corrige una foto: la vuelve a dibujar entera.
 * Medido sobre fotos reales del catalogo, sin este encabezado y con calidad
 * media el modelo invento una moldura de escayola en el techo de una sala y
 * cambio un plafon de superficie por un empotrado, con la instruccion explicita
 * de no tocar nada. Con este encabezado y calidad alta, la misma prueba en una
 * cocina conservo los muebles, el granito, los cuadros y hasta el balde de la
 * trapeadora.
 *
 * No garantiza nada —es un modelo, no un filtro— y por eso el asesor mira el
 * resultado antes de que sustituya a la foto del anuncio. Es lo que reduce el
 * ruido, no lo que lo elimina.
 */
export function encabezadoDocumental(kind: RetouchKind): string {
  const comun = [
    'Esta es una FOTOGRAFIA DOCUMENTAL de un inmueble real que esta a la venta o en arriendo.',
    'Una persona va a visitar este inmueble fisicamente y va a comparar lo que ve con esta foto.',
    'Conserva exactamente la geometria, las proporciones, el encuadre y el punto de vista.',
    'Conserva todos los objetos, muebles, acabados, materiales y elementos arquitectonicos tal y como estan.',
    'No inventes detalles constructivos que no se vean en la imagen original: ni molduras, ni zocalos, ni luminarias, ni texturas.',
    'Conserva cualquier marca de agua, logotipo o texto sobreimpreso, con la misma posicion y el mismo texto.',
    'Conserva los letreros, numeros de puerta y rotulos legibles, con su texto original.',
  ];

  if (kind === RetouchKind.REVELADO) {
    comun.push(
      'La unica libertad que tienes es fotografica: exposicion, contraste, balance de blancos, saturacion, nitidez y ruido.',
      'No añadas, no quites y no muevas absolutamente nada.',
    );
  } else {
    // En una alteracion el cambio pedido es el motivo de la llamada, asi que
    // no se puede decir "no cambies nada". Lo que se acota es el radio: solo
    // eso, y el resto del inmueble intacto.
    comun.push(
      'Se te ha pedido un cambio concreto en el contenido. Haz UNICAMENTE ese cambio.',
      'Todo lo demas del inmueble —fachada, acabados, mobiliario, estado de conservacion, suciedad, desgaste— debe quedar exactamente igual que en el original.',
      'No aproveches para limpiar, repintar, renovar ni mejorar el estado del inmueble.',
    );
  }

  return comun.join(' ');
}

/**
 * Los nombres de los campos de coste que publica `/image-ai/status`.
 *
 * Viven aqui —en un fichero sin dependencias— para que una prueba pueda
 * vigilarlos sin levantar el modulo entero de Nest. Ver `retouch-costes.spec`:
 * este contrato ya se rompio dos veces, siempre en silencio.
 */
export const COSTES_PUBLICADOS = [
  'analisisUsd',
  'moneda',
  'retoqueUsd',
] as const;
