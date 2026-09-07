import {
  clasificarInstruccion,
  encabezadoDocumental,
} from './retouch-frontier';
import { RetouchKind } from './domain/image-retouch.enums';

/**
 * La frontera entre revelar y falsear, vigilada.
 *
 * Estas pruebas no comprueban una funcion: comprueban una decision de negocio.
 * Si alguien mueve una palabra de lista, lo que cambia no es un color de un
 * boton, es si una foto de un inmueble real se marca o no como alterada. Por
 * eso los casos estan escritos con frases que un asesor escribiria de verdad, y
 * no con cadenas de prueba.
 */
describe('clasificarInstruccion', () => {
  describe('revelar: la misma escena, mejor fotografiada', () => {
    it.each([
      'La alcoba salio muy oscura, sube la exposicion',
      'Corrige el balance de blancos, tiene una dominante amarillenta',
      'Sube un poco el contraste y la nitidez',
      'La foto esta torcida, enderezala',
      'Baja la saturacion que los colores estan muy fuertes',
    ])('%s', (frase) => {
      expect(clasificarInstruccion(frase).kind).toBe(RetouchKind.REVELADO);
    });

    it('quitar ruido sigue siendo revelar: el ruido no estaba en la habitacion', () => {
      // El verbo es de quitar, pero lo que se quita es un defecto de la camara,
      // no un objeto del inmueble. Es el caso que mas facilmente se
      // clasificaria mal, y por eso esta escrito.
      const veredicto = clasificarInstruccion('Quita el ruido de la sombra');
      expect(veredicto.kind).toBe(RetouchKind.REVELADO);
      expect(veredicto.advertencia).toBeNull();
    });

    it('recuperar zonas quemadas avisa, pero no pide confirmacion', () => {
      // Es la unica advertencia que convive con REVELADO, y esta medida: al
      // pedirle recuperar unas ventanas quemadas de una sala real, el modelo
      // borro la cenefa tallada del ventanal. Ahi no hay datos, hay relleno.
      const veredicto = clasificarInstruccion(
        'Recupera el detalle de las ventanas quemadas',
      );
      expect(veredicto.kind).toBe(RetouchKind.REVELADO);
      expect(veredicto.advertencia).toContain('INVENTARSE');
    });

    it('no hay advertencia que enseñar cuando solo se revela', () => {
      expect(clasificarInstruccion('Sube la luz').advertencia).toBeNull();
    });
  });

  describe('falsear: cambia lo que hay', () => {
    it.each([
      ['Pon un cielo azul despejado', 'cielo'],
      ['Quita los cables de la calle y el poste', 'cables'],
      ['Amuebla la sala, que esta vacia', 'sala'],
      ['Quita el carro que esta en la entrada', 'carro'],
      ['Pon el cesped verde', 'cesped'],
      ['Borra a la señora del balcon', 'señora'],
      ['Limpia y ordena la cocina', 'limpiar'],
      ['Pinta la fachada de blanco', 'pintar'],
    ])('%s', (frase) => {
      expect(clasificarInstruccion(frase).kind).toBe(RetouchKind.ALTERACION);
    });

    it('explica que palabra lo decidio, para poder discutirlo', () => {
      const veredicto = clasificarInstruccion('Ponle un cielo azul bonito');
      expect(veredicto.motivos).toContain('cielo');
      expect(veredicto.advertencia).toContain('va a visitar');
    });

    it('lo grave manda aunque venga detras de algo legitimo', () => {
      // "Sube la luz" es revelado y va primero; da igual.
      const veredicto = clasificarInstruccion(
        'Sube la luz y de paso quitale los cables',
      );
      expect(veredicto.kind).toBe(RetouchKind.ALTERACION);
    });

    it('un "quita" sin decir que se quita se trata como alteracion', () => {
      // Se clasifica por lo que NO dice. Es deliberado: ante la duda, marcar.
      const veredicto = clasificarInstruccion('Quitale lo feo del fondo');
      expect(veredicto.kind).toBe(RetouchKind.ALTERACION);
      expect(veredicto.advertencia).toContain('conviene escribirlo asi');
    });
  });

  describe('ocultar un defecto: ni marketing ni exageracion', () => {
    it.each([
      'Quita la humedad del techo de la alcoba',
      'Disimula las grietas de la pared',
      'Tapa la filtracion de la ventana',
      'Borra el moho del baño',
      'Quita el oxido de la reja',
    ])('%s', (frase) => {
      expect(clasificarInstruccion(frase).kind).toBe(
        RetouchKind.OCULTA_DEFECTO,
      );
    });

    it('manda sobre la alteracion normal, aunque tambien se pida un cielo', () => {
      const veredicto = clasificarInstruccion(
        'Pon cielo azul y quita la humedad de la fachada',
      );
      expect(veredicto.kind).toBe(RetouchKind.OCULTA_DEFECTO);
    });

    it('apunta a la salida honesta en vez de solo prohibir', () => {
      const veredicto = clasificarInstruccion('Quita la mancha de humedad');
      expect(veredicto.advertencia).toContain('una foto nueva');
    });
  });

  describe('trampas del castellano', () => {
    it('las tildes no cambian el veredicto', () => {
      expect(clasificarInstruccion('Quita la humedád').kind).toBe(
        clasificarInstruccion('Quita la humedad').kind,
      );
    });

    it('las mayusculas tampoco', () => {
      expect(clasificarInstruccion('PON UN CIELO AZUL').kind).toBe(
        RetouchKind.ALTERACION,
      );
    });

    it('"camara" no contiene "cama": la frontera es de palabra entera', () => {
      // Sin frontera de palabra, "el ruido de la camara" seria una alteracion
      // por llevar "cama" dentro, y el asesor no entenderia nada.
      expect(clasificarInstruccion('Corrige el ruido de la camara').kind).toBe(
        RetouchKind.REVELADO,
      );
    });

    it('"solo" no contiene "sol"', () => {
      expect(clasificarInstruccion('Ajusta solo el contraste').kind).toBe(
        RetouchKind.REVELADO,
      );
    });
  });
});

describe('encabezadoDocumental', () => {
  it('en un revelado prohibe tocar nada', () => {
    const texto = encabezadoDocumental(RetouchKind.REVELADO);
    expect(texto).toContain('No añadas, no quites y no muevas');
  });

  it('en una alteracion acota el radio en vez de prohibir el cambio', () => {
    // No puede decir "no cambies nada": el cambio ES el encargo. Lo que hace
    // falta es que no aproveche para renovar el inmueble de paso.
    const texto = encabezadoDocumental(RetouchKind.ALTERACION);
    expect(texto).toContain('UNICAMENTE ese cambio');
    expect(texto).toContain('No aproveches para limpiar');
  });

  it('siempre pide conservar la marca de agua de la agencia', () => {
    // Medido: en una fachada real el modelo borro entera la marca "SERRANO
    // INMOBILIARIA". Si se va la marca, la foto sale al portal sin firma.
    for (const kind of Object.values(RetouchKind)) {
      expect(encabezadoDocumental(kind)).toContain('marca de agua');
    }
  });

  it('siempre dice que alguien va a visitar el inmueble', () => {
    for (const kind of Object.values(RetouchKind)) {
      expect(encabezadoDocumental(kind)).toContain('visitar');
    }
  });
});
