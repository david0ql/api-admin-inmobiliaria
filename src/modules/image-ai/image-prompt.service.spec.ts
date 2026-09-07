import { huellaPrompt, ImagePromptService } from './image-prompt.service';
import type { ImagePrompt } from './domain/image-prompt.entity';

/**
 * De donde sale el prompt que se le manda al modelo.
 *
 * Esto existe por una duda concreta y cara: si el analisis leyera el fichero
 * del repositorio en vez de la version activa de la tabla, el editor del panel
 * seria un adorno — la agencia guardaria, veria "version 5 activa" y no
 * cambiaria nada, con la factura del modelo pagada igual. Es el peor tipo de
 * fallo: silencioso y por el lado del dinero.
 *
 * Asi que la regla queda escrita y vigilada: **si hay una version activa en la
 * tabla, el fichero del repositorio no se abre**. El fichero solo interviene
 * para sembrar la version 1 cuando no hay ninguna, y cuando el editor pide el
 * texto de fabrica para enseñarlo al lado del editado.
 */
describe('ImagePromptService: de donde sale el prompt', () => {
  /** Un repositorio de mentira con las cuatro operaciones que usa el servicio. */
  function repoFalso(filas: Partial<ImagePrompt>[]) {
    const datos = [...filas];
    return {
      datos,
      findOne: jest.fn(
        ({
          where,
          order,
        }: {
          where: Record<string, unknown>;
          order?: { version?: 'ASC' | 'DESC' };
        }) => {
          const casan = datos.filter((f) =>
            Object.entries(where).every(
              ([k, v]) => (f as Record<string, unknown>)[k] === v,
            ),
          );
          // El orden importa: `active()` se apoya en el para rescatar la ULTIMA
          // version cuando ninguna esta activa.
          if (order?.version) {
            casan.sort((a, b) =>
              order.version === 'DESC'
                ? (b.version ?? 0) - (a.version ?? 0)
                : (a.version ?? 0) - (b.version ?? 0),
            );
          }
          return Promise.resolve(casan[0] ?? null);
        },
      ),
      count: jest.fn(() => Promise.resolve(datos.length)),
      create: jest.fn((x: Partial<ImagePrompt>) => x),
      save: jest.fn((x: Partial<ImagePrompt>) => {
        datos.push(x);
        return Promise.resolve(x);
      }),
      update: jest.fn(() => Promise.resolve(undefined)),
    };
  }

  const dataSourceFalso = { transaction: jest.fn() };

  function servicio(repo: ReturnType<typeof repoFalso>) {
    return new ImagePromptService(repo as never, dataSourceFalso as never);
  }

  it('con una version activa, devuelve ESA y no toca el fichero', async () => {
    const repo = repoFalso([
      { version: 1, body: 'el texto del repositorio', active: false },
      { version: 4, body: 'lo que escribio la agencia', active: true },
    ]);
    const s = servicio(repo);
    const espia = jest.spyOn(s, 'defaultBody');

    const activa = await s.active();

    expect(activa.version).toBe(4);
    expect(activa.body).toBe('lo que escribio la agencia');
    // Ni se leyo el fichero ni se sembro nada.
    expect(espia).not.toHaveBeenCalled();
    expect(repo.save).not.toHaveBeenCalled();
  });

  it('sin ninguna version, siembra la 1 con el fichero del repositorio', async () => {
    const repo = repoFalso([]);
    const s = servicio(repo);

    const activa = await s.active();

    expect(activa.version).toBe(1);
    expect(activa.active).toBe(true);
    expect(activa.body).toBe(s.defaultBody());
    expect(repo.save).toHaveBeenCalledTimes(1);
  });

  /*
    Si alguien deja la tabla con versiones pero ninguna activa, se rescata la
    ultima en vez de sembrar una version 1 encima: sembrar ahi pisaria el
    trabajo de la agencia con el texto de fabrica sin que nadie lo pidiera.
  */
  it('con versiones pero ninguna activa, rescata la ultima', async () => {
    const repo = repoFalso([
      { version: 1, body: 'vieja', active: false },
      { version: 2, body: 'la ultima que hubo', active: false },
    ]);
    const s = servicio(repo);
    jest.spyOn(s, 'activate').mockImplementation((version: number) => {
      const f = repo.datos.find((d) => d.version === version)!;
      f.active = true;
      return Promise.resolve(f as ImagePrompt);
    });

    const activa = await s.active();

    expect(activa.version).toBe(2);
    expect(repo.save).not.toHaveBeenCalled();
  });

  /*
    La huella existe para contestar lo que el numero de version no contesta:
    con que TEXTO se produjo un resultado. Dos casos que el numero confunde y
    ella separa — un texto editado bajo la misma version, y dos versiones
    distintas que dicen lo mismo.
  */
  describe('huellaPrompt', () => {
    it('cambia si cambia el texto, aunque la version sea la misma', () => {
      expect(huellaPrompt('analiza las fotos')).not.toBe(
        huellaPrompt('analiza las fotos.'),
      );
    });

    it('es la misma para el mismo texto, aunque la version sea otra', () => {
      expect(huellaPrompt('mismo texto')).toBe(huellaPrompt('mismo texto'));
    });

    it('cabe en la columna', () => {
      expect(huellaPrompt('x')).toHaveLength(16);
      expect(huellaPrompt('x')).toMatch(/^[0-9a-f]{16}$/);
    });
  });

  it('el texto de fabrica sale del fichero y trae el contrato dentro', () => {
    const s = servicio(repoFalso([]));
    const texto = s.defaultBody();
    // No se comprueba la redaccion —es de quien afina el prompt— sino que el
    // fichero se encuentra y no es el texto de emergencia.
    expect(texto.length).toBeGreaterThan(500);
    expect(texto.toLowerCase()).toContain('json');
  });
});
