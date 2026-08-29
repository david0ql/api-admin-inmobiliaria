import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, SelectQueryBuilder } from 'typeorm';
import { Agent } from '../iam/domain/agent.entity';
import { Branch } from '../branches/domain/branch.entity';
import { Role } from '../iam/domain/role.enum';
import { applyBranchScope } from '../iam/scope';
import { GeocodeService } from '../public/geocode.service';
import type { AuthenticatedActor } from '../../shared/request-context/request-context';
import {
  AttendanceMark,
  AttendanceMarkType,
} from './domain/attendance-mark.entity';
import type {
  AttendanceHistoryDto,
  AttendanceRangeDto,
  CreateAttendanceMarkDto,
} from './attendance.dto';

/**
 * La zona en la que vive la inmobiliaria, y por tanto la unica en la que la
 * palabra "dia" significa algo aqui.
 */
const ZONA = 'America/Bogota';

/** Rango maximo de una consulta de historial. Un año de calendario cabe. */
const DIAS_MAXIMOS = 366;

/** Marcas devueltas por el panel si no pide otra cosa. */
const TOPE_POR_DEFECTO = 5_000;

/** Una marca tal y como la pinta la pantalla. */
export interface MarcaVista {
  id: string;
  type: AttendanceMarkType;
  /** El instante, en ISO con zona. */
  at: string;
  /** El dia al que pertenece EN BOGOTA. */
  date: string;
  /** La hora en Bogota, ya formateada: la pantalla no tiene que convertir. */
  time: string;
  latitude: number;
  longitude: number;
  accuracyM: number | null;
  address: string | null;
  agentId: string;
  agentName: string;
  branchId: string | null;
  branchName: string | null;
}

/**
 * Una jornada: el par entrada-salida.
 *
 * `checkOut` nulo significa que sigue dentro, y entonces `minutes` es nulo
 * tambien: no se inventa una hora de salida. `checkIn` nulo solo puede pasar
 * con datos incompletos —una salida cuya entrada quedo fuera del rango o nunca
 * existio—; se devuelve igual para que la pantalla pueda enseñar el hueco en
 * vez de tragarselo.
 */
export interface Jornada {
  checkIn: MarcaVista | null;
  checkOut: MarcaVista | null;
  minutes: number | null;
  open: boolean;
}

/** El consolidado de una persona en un dia. */
export interface DiaAsistencia {
  date: string;
  agentId: string;
  agentName: string;
  branchId: string | null;
  branchName: string | null;
  marks: MarcaVista[];
  sessions: Jornada[];
  /** Suma de los pares CERRADOS. Lo abierto no suma. */
  workedMinutes: number;
  /** Quedo alguna jornada sin cerrar ese dia. */
  open: boolean;
}

export interface EstadoHoy {
  date: string;
  /** Si ahora mismo esta dentro: lo dice la ultima marca, no el reloj. */
  working: boolean;
  lastMark: MarcaVista | null;
  /** Desde cuando lleva dentro, si lo esta. */
  openSince: string | null;
  /** Minutos transcurridos desde esa entrada. Informativo, no fichado. */
  openMinutes: number | null;
  marks: MarcaVista[];
  sessions: Jornada[];
  workedMinutes: number;
}

interface Fila {
  id: string;
  type: AttendanceMarkType;
  at: Date;
  day: string;
  hhmm: string;
  lat: number;
  lng: number;
  accuracy: number | null;
  address: string | null;
  agent_id: string;
  agent_first: string;
  agent_last: string | null;
  branch_id: string | null;
  branch_name: string | null;
}

/**
 * Asistencia: marcar y leer lo marcado.
 *
 * Dos decisiones gobiernan todo lo de aqui:
 *
 *  - Quien ficha sale del token y solo del token. No hay ninguna ruta que
 *    acepte "marca por fulano", ni siquiera para el administrador: un fichaje
 *    que otro puede escribir en tu nombre no vale como fichaje.
 *
 *  - El dia se decide en SQL con `AT TIME ZONE 'America/Bogota'` y nunca en
 *    JavaScript. Bucaramanga va cinco horas por detras de UTC, asi que quien
 *    sale a las 20:00 sale a la 01:00 UTC del dia siguiente: agrupando en UTC
 *    esa jornada aparece partida entre dos dias y el consolidado de la persona
 *    sale mal justo los dias que mas trabajo.
 */
@Injectable()
export class AttendanceService {
  constructor(
    @InjectRepository(AttendanceMark)
    private readonly repo: Repository<AttendanceMark>,
    private readonly geocode: GeocodeService,
  ) {}

  // --- marcar ------------------------------------------------------------

  /**
   * "Ya entré" / "ya me voy".
   *
   * Devuelve tambien el estado del dia porque la pantalla lo necesita justo
   * despues: ahorra el viaje de ida y vuelta y, sobre todo, evita que lo que
   * ve la persona dependa de dos respuestas que pueden llegar desordenadas.
   */
  async mark(
    dto: CreateAttendanceMarkDto,
    actor: AuthenticatedActor,
  ): Promise<{ mark: MarcaVista; status: EstadoHoy }> {
    if (Math.abs(dto.latitude) > 90 || Math.abs(dto.longitude) > 180) {
      throw new BadRequestException(
        'Las coordenadas recibidas no corresponden a ningún punto de la Tierra',
      );
    }

    const ultima = await this.ultimaMarca(actor.id);

    /*
      Se comprueba contra la ULTIMA marca, no contra las de hoy: quien entro
      ayer a las once de la noche y no ha salido sigue dentro esta mañana, y
      dejarle volver a entrar crearia una jornada abierta que ya no cierra
      nadie.
    */
    if (ultima?.type === dto.type) {
      throw new ConflictException(
        dto.type === AttendanceMarkType.IN
          ? `Ya tienes una entrada abierta desde las ${ultima.time} del ${ultima.date}. Marca la salida antes de volver a entrar.`
          : `Tu última marca ya fue una salida (${ultima.time} del ${ultima.date}). Marca la entrada antes de salir.`,
      );
    }
    if (!ultima && dto.type === AttendanceMarkType.OUT) {
      throw new ConflictException(
        'No tienes ninguna entrada abierta: marca primero «ya entré».',
      );
    }

    /*
      La direccion se resuelve ANTES de guardar y su fallo no interrumpe nada:
      `address` devuelve null si el servicio de terceros no contesta. Es un
      adorno del mapa —las coordenadas, que son el dato, ya vienen— y perder
      el fichaje de alguien porque un tercero se cayo seria inaceptable.
    */
    const address = await this.geocode.address(dto.latitude, dto.longitude);

    const guardada = await this.repo.save(
      this.repo.create({
        type: dto.type,
        agentId: actor.id,
        branchId: this.sedeDe(actor),
        /*
          La hora la pone el servidor. El reloj del movil de quien ficha es
          suyo y se puede cambiar en dos toques: aceptarlo seria firmar la
          hora que la persona quiera.
        */
        happenedAt: new Date(),
        latitude: dto.latitude,
        longitude: dto.longitude,
        accuracyM:
          dto.accuracyM === undefined ? null : Math.round(dto.accuracyM),
        address,
      }),
    );

    return {
      mark: await this.marcaPorId(guardada.id),
      status: await this.today(actor),
    };
  }

  /**
   * La sede que se copia en la marca.
   *
   * Sale del agente y no del selector de sede: la cabecera `x-branch` dice
   * "quiero mirar esta oficina", no "trabajo en ella". Para quien no pertenece
   * a ninguna —administracion y direccion— queda nula, y esta bien que asi
   * sea: el administrador no esta obligado a fichar, y si ficha su marca no
   * pertenece a la sede que tuviera puesta en el selector.
   */
  private sedeDe(actor: AuthenticatedActor): string | null {
    return actor.branchId ?? null;
  }

  // --- lectura -----------------------------------------------------------

  /** Mi estado de hoy: si estoy dentro, mi ultima marca y mi consolidado. */
  async today(actor: AuthenticatedActor): Promise<EstadoHoy> {
    const hoy = this.hoy();
    const ultima = await this.ultimaMarca(actor.id);

    /*
      Se leen tambien las marcas de ayer aunque solo se devuelva hoy: quien
      entro a las 23:00 y sigue dentro a las 00:30 no tiene NINGUNA marca hoy,
      y sin la de ayer la pantalla le diria que esta fuera.
    */
    const dias = await this.consolidado({ from: hoy, to: hoy }, (qb) =>
      qb.andWhere('mark.agent_id = :yo', { yo: actor.id }),
    );
    const dia = dias.find((d) => d.date === hoy);
    const abierta = ultima?.type === AttendanceMarkType.IN ? ultima : null;

    return {
      date: hoy,
      working: Boolean(abierta),
      lastMark: ultima,
      openSince: abierta?.at ?? null,
      openMinutes: abierta
        ? Math.max(
            0,
            Math.round((Date.now() - new Date(abierta.at).getTime()) / 60_000),
          )
        : null,
      marks: dia?.marks ?? [],
      sessions: dia?.sessions ?? [],
      workedMinutes: dia?.workedMinutes ?? 0,
    };
  }

  /** Mi historial: mis marcas y mi consolidado por dia. */
  async mine(
    dto: AttendanceRangeDto,
    actor: AuthenticatedActor,
  ): Promise<{
    from: string;
    to: string;
    days: DiaAsistencia[];
    workedMinutes: number;
  }> {
    const rango = this.rango(dto);
    const days = await this.consolidado(rango, (qb) =>
      qb.andWhere('mark.agent_id = :yo', { yo: actor.id }),
    );
    return {
      ...rango,
      days,
      workedMinutes: days.reduce((suma, d) => suma + d.workedMinutes, 0),
    };
  }

  /**
   * El historial del panel de administracion.
   *
   * Devuelve las marcas con todo lo que hace falta para pintar el mapa
   * —coordenadas, direccion, instante, tipo, persona y sede— y ademas
   * emparejadas en jornadas, para que la pantalla pueda unir con una linea la
   * entrada y la salida de cada una sin tener que adivinar cual va con cual.
   */
  async history(
    dto: AttendanceHistoryDto,
    actor: AuthenticatedActor,
  ): Promise<{
    from: string;
    to: string;
    days: DiaAsistencia[];
    agents: {
      agentId: string;
      agentName: string;
      branchId: string | null;
      branchName: string | null;
      days: number;
      workedMinutes: number;
      openSessions: number;
    }[];
    truncated: boolean;
  }> {
    const rango = this.rango(dto);
    const tope = dto.limit ?? TOPE_POR_DEFECTO;

    const { days, truncated } = await this.consolidadoConTope(
      rango,
      (qb) => {
        if (dto.agentId)
          qb.andWhere('mark.agent_id = :agentId', { agentId: dto.agentId });
        /*
          Quien no manda en un equipo solo se ve a si mismo, aunque llame a
          esta ruta: el rol abre la puerta, pero el alcance lo decide la
          consulta. Un VIEWER de contabilidad ve el inventario entero y no
          tiene por que ver a que hora llega cada persona.
        */
        if (!mandaEnEquipo(actor.role as Role))
          qb.andWhere('mark.agent_id = :yo', { yo: actor.id });
        /*
          Y la sede la pone el interceptor: para un coordinador filtra por la
          suya sin que esta consulta tenga que saber nada, y por eso se aplica
          sobre el QueryBuilder y no en memoria.
        */
        applyBranchScope(qb, 'mark.branch_id');
        return qb;
      },
      tope,
    );

    const porAgente = new Map<string, DiaAsistencia[]>();
    for (const dia of days)
      porAgente.set(dia.agentId, [...(porAgente.get(dia.agentId) ?? []), dia]);

    const agents = [...porAgente.values()].map((suyos) => ({
      agentId: suyos[0].agentId,
      agentName: suyos[0].agentName,
      branchId: suyos[0].branchId,
      branchName: suyos[0].branchName,
      days: suyos.length,
      workedMinutes: suyos.reduce((suma, d) => suma + d.workedMinutes, 0),
      openSessions: suyos.reduce(
        (suma, d) => suma + d.sessions.filter((j) => j.open).length,
        0,
      ),
    }));
    agents.sort((a, b) => a.agentName.localeCompare(b.agentName));

    return { ...rango, days, agents, truncated };
  }

  // --- consultas ---------------------------------------------------------

  private async marcaPorId(id: string): Promise<MarcaVista> {
    const fila = await this.select()
      .andWhere('mark.id = :id', { id })
      .getRawOne<Fila>();
    if (!fila) throw new NotFoundException(`Marca ${id} no encontrada`);
    return vista(fila);
  }

  /** La ultima marca de una persona, sea de hoy o de hace tres semanas. */
  private async ultimaMarca(agentId: string): Promise<MarcaVista | null> {
    const fila = await this.select()
      .andWhere('mark.agent_id = :agentId', { agentId })
      .orderBy('mark.happenedAt', 'DESC')
      .addOrderBy('mark.createdAt', 'DESC')
      .limit(1)
      .getRawOne<Fila>();
    return fila ? vista(fila) : null;
  }

  private async consolidado(
    rango: { from: string; to: string },
    filtro: (qb: SelectQueryBuilder<AttendanceMark>) => unknown,
  ): Promise<DiaAsistencia[]> {
    const { days } = await this.consolidadoConTope(rango, filtro, 20_000);
    return days;
  }

  private async consolidadoConTope(
    rango: { from: string; to: string },
    filtro: (qb: SelectQueryBuilder<AttendanceMark>) => unknown,
    tope: number,
  ): Promise<{ days: DiaAsistencia[]; truncated: boolean }> {
    const qb = this.select();

    /*
      Se lee un dia mas por cada lado del rango pedido, y solo para emparejar.
      Una jornada que empezo el 31 de julio y cerro el 1 de agosto tiene que
      seguir siendo una jornada aunque se pregunte por agosto: sin el dia de
      antes, esa salida apareceria como una salida huerfana.

      Los limites se calculan en SQL a partir de la fecha de calendario, para
      que la ventana empiece a medianoche EN BOGOTA y no a medianoche UTC (que
      alli son las siete de la tarde del dia anterior).
    */
    qb.andWhere(
      `mark.happened_at >= ((CAST(:from AS timestamp) - interval '1 day') AT TIME ZONE :zona)`,
      { from: rango.from, zona: ZONA },
    ).andWhere(
      `mark.happened_at < ((CAST(:to AS timestamp) + interval '2 day') AT TIME ZONE :zona)`,
      { to: rango.to, zona: ZONA },
    );

    filtro(qb);

    const filas = await qb
      .orderBy('mark.happenedAt', 'ASC')
      .limit(tope + 1)
      .getRawMany<Fila>();

    const truncated = filas.length > tope;
    return {
      days: consolidar(filas.slice(0, tope).map(vista), rango.from, rango.to),
      truncated,
    };
  }

  /**
   * La proyeccion que consume la pantalla.
   *
   * El dia y la hora se calculan en Postgres y no en JavaScript: es el mismo
   * calculo para la agrupacion y para lo que se enseña, y asi no puede pasar
   * que una marca se agrupe en un dia y se pinte con la fecha de otro.
   */
  private select(): SelectQueryBuilder<AttendanceMark> {
    return this.repo
      .createQueryBuilder('mark')
      .innerJoin(Agent, 'agent', 'agent.id = mark.agent_id')
      .leftJoin(Branch, 'branch', 'branch.id = mark.branch_id')
      .select('mark.id', 'id')
      .addSelect('mark.type', 'type')
      .addSelect('mark.happenedAt', 'at')
      .addSelect(
        `to_char(mark.happened_at AT TIME ZONE '${ZONA}', 'YYYY-MM-DD')`,
        'day',
      )
      .addSelect(
        `to_char(mark.happened_at AT TIME ZONE '${ZONA}', 'HH24:MI')`,
        'hhmm',
      )
      .addSelect('mark.latitude', 'lat')
      .addSelect('mark.longitude', 'lng')
      .addSelect('mark.accuracyM', 'accuracy')
      .addSelect('mark.address', 'address')
      .addSelect('mark.agentId', 'agent_id')
      .addSelect('agent.firstName', 'agent_first')
      .addSelect('agent.lastName', 'agent_last')
      .addSelect('mark.branchId', 'branch_id')
      .addSelect('branch.name', 'branch_name');
  }

  // --- fechas ------------------------------------------------------------

  /** Hoy, en Bogota. Nunca `new Date().toISOString()`: eso es hoy en UTC. */
  private hoy(): string {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: ZONA,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date());
  }

  private rango(dto: AttendanceRangeDto): { from: string; to: string } {
    const to = dto.to ?? this.hoy();
    const from = dto.from ?? sumarDias(to, -29);
    if (from > to)
      throw new BadRequestException('«Desde» tiene que ser anterior a «hasta»');
    if (diasEntre(from, to) > DIAS_MAXIMOS) {
      throw new BadRequestException(
        `El rango no puede pasar de ${DIAS_MAXIMOS} días`,
      );
    }
    return { from, to };
  }
}

/** Quien puede ver la asistencia de mas gente que la suya. */
function mandaEnEquipo(role: Role): boolean {
  return (
    role === Role.ADMIN ||
    role === Role.DIRECTOR ||
    role === Role.COORDINATOR ||
    role === Role.MANAGER
  );
}

function vista(fila: Fila): MarcaVista {
  return {
    id: fila.id,
    type: fila.type,
    at: new Date(fila.at).toISOString(),
    date: fila.day,
    time: fila.hhmm,
    latitude: Number(fila.lat),
    longitude: Number(fila.lng),
    accuracyM: fila.accuracy === null ? null : Number(fila.accuracy),
    address: fila.address,
    agentId: fila.agent_id,
    agentName: [fila.agent_first, fila.agent_last]
      .filter(Boolean)
      .join(' ')
      .trim(),
    branchId: fila.branch_id,
    branchName: fila.branch_name,
  };
}

/**
 * De marcas sueltas a jornadas y dias.
 *
 * El emparejamiento se hace sobre la secuencia COMPLETA de cada persona, no
 * dia a dia, y cada jornada se apunta al dia en que EMPEZO. Es lo unico que
 * funciona cuando alguien cierra pasada la medianoche: la entrada de las 23:40
 * y la salida de las 00:20 son un rato de trabajo del jueves, no veinte
 * minutos sueltos del viernes.
 *
 * Las marcas, en cambio, se listan cada una en su propio dia: son hechos con
 * fecha, y la pantalla las enseña donde ocurrieron.
 */
function consolidar(
  marcas: MarcaVista[],
  desde: string,
  hasta: string,
): DiaAsistencia[] {
  const porAgente = new Map<string, MarcaVista[]>();
  for (const marca of marcas)
    porAgente.set(marca.agentId, [
      ...(porAgente.get(marca.agentId) ?? []),
      marca,
    ]);

  const dias = new Map<string, DiaAsistencia>();
  const dia = (fecha: string, ref: MarcaVista): DiaAsistencia | null => {
    // Los dias de mas que se leyeron para emparejar no se devuelven.
    if (fecha < desde || fecha > hasta) return null;
    const clave = `${ref.agentId}|${fecha}`;
    const existente = dias.get(clave);
    if (existente) return existente;
    const nuevo: DiaAsistencia = {
      date: fecha,
      agentId: ref.agentId,
      agentName: ref.agentName,
      branchId: ref.branchId,
      branchName: ref.branchName,
      marks: [],
      sessions: [],
      workedMinutes: 0,
      open: false,
    };
    dias.set(clave, nuevo);
    return nuevo;
  };

  for (const propias of porAgente.values()) {
    propias.sort((a, b) => a.at.localeCompare(b.at));
    for (const marca of propias) dia(marca.date, marca)?.marks.push(marca);

    const jornadas: Jornada[] = [];
    let abierta: MarcaVista | null = null;
    for (const marca of propias) {
      if (marca.type === AttendanceMarkType.IN) {
        /*
          Dos entradas seguidas no deberian existir —se rechazan con 409 al
          escribir— pero si alguna vez existen no se pierde ninguna: la
          anterior se cierra como abierta en vez de desaparecer.
        */
        if (abierta)
          jornadas.push({
            checkIn: abierta,
            checkOut: null,
            minutes: null,
            open: true,
          });
        abierta = marca;
      } else {
        jornadas.push({
          checkIn: abierta,
          checkOut: marca,
          minutes: abierta ? minutosEntre(abierta, marca) : null,
          open: false,
        });
        abierta = null;
      }
    }
    if (abierta)
      jornadas.push({
        checkIn: abierta,
        checkOut: null,
        minutes: null,
        open: true,
      });

    for (const jornada of jornadas) {
      const ref = jornada.checkIn ?? jornada.checkOut;
      if (!ref) continue;
      const suyo = dia(ref.date, ref);
      if (!suyo) continue;
      suyo.sessions.push(jornada);
      // Solo suman los pares cerrados: la jornada abierta se informa como
      // abierta y no se le inventa una hora de salida.
      if (jornada.minutes !== null) suyo.workedMinutes += jornada.minutes;
      if (jornada.open) suyo.open = true;
    }
  }

  return [...dias.values()].sort(
    (a, b) =>
      b.date.localeCompare(a.date) || a.agentName.localeCompare(b.agentName),
  );
}

function minutosEntre(entrada: MarcaVista, salida: MarcaVista): number {
  const minutos = Math.round(
    (new Date(salida.at).getTime() - new Date(entrada.at).getTime()) / 60_000,
  );
  return Math.max(0, minutos);
}

/** Aritmetica de calendario en UTC para que no la mueva ninguna zona. */
function sumarDias(fecha: string, dias: number): string {
  const base = new Date(`${fecha}T00:00:00Z`);
  base.setUTCDate(base.getUTCDate() + dias);
  return base.toISOString().slice(0, 10);
}

function diasEntre(desde: string, hasta: string): number {
  const a = new Date(`${desde}T00:00:00Z`).getTime();
  const b = new Date(`${hasta}T00:00:00Z`).getTime();
  return Math.round((b - a) / 86_400_000) + 1;
}
