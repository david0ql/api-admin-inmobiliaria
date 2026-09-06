import type { DataSource, SelectQueryBuilder } from 'typeorm';
import { Property } from '../properties/domain/property.entity';
import {
  FamilyKind,
  FamilyStatus,
  PropertyFamily,
} from '../properties/domain/property-family.entity';
import {
  Availability,
  PublicationStatus,
} from '../properties/domain/property.enums';
import { UnitType } from '../properties/domain/unit-type.entity';
import { Client } from '../crm/domain/client.entity';
import {
  InterestRole,
  InterestStatus,
  PropertyInterest,
} from '../crm/domain/property-interest.entity';
import {
  Appointment,
  AppointmentStatus,
  AppointmentType,
} from '../scheduling/domain/appointment.entity';
import { Agent } from '../iam/domain/agent.entity';
import { Branch } from '../branches/domain/branch.entity';
import { applyBranchScope, applyOwnershipScope } from '../iam/scope';
import type { AuthenticatedActor } from '../../shared/request-context/request-context';

/**
 * Las hojas de la vista de hoja de calculo.
 *
 * Una hoja de calculo quiere filas y columnas, no arboles: el asesor no es un
 * objeto dentro del inmueble, es la columna "Asesor". Por eso aqui no hay
 * `leftJoinAndSelect` ni entidades hidratadas — cada hoja es una consulta plana
 * cuyo resultado se vuelca tal cual en la rejilla.
 *
 * Todo lo que sale de aqui es de SOLO LECTURA: la hoja es una capa de analisis
 * y nada de lo que el usuario monte encima vuelve al CRM.
 */

/**
 * La zona en la que vive la inmobiliaria. Las fechas se formatean en ella y en
 * Postgres, como en el fichaje: un cierre del 31 de julio a las nueve de la
 * noche no puede aparecer en agosto porque en UTC ya sea dia 1.
 */
const ZONA = 'America/Bogota';

/**
 * Que es cada columna para la rejilla.
 *
 * No es decoracion: `moneda` se alinea a la derecha y se suma, `fecha` entra en
 * una tabla dinamica agrupada por mes y `texto` no. Sin el tipo, la interfaz
 * tendria que adivinarlo mirando los valores — y adivinaria mal con una columna
 * entera vacia.
 */
export type TipoColumna =
  | 'texto'
  | 'numero'
  | 'moneda'
  | 'fecha'
  | 'fechaHora'
  | 'booleano'
  /**
   * Un uuid con el que se cruzan las hojas entre si.
   *
   * Es su propio tipo y no `texto` porque para una persona no es texto: no se
   * lee, no se agrupa —agrupar por id da un grupo por fila— y ocupa media
   * pantalla de ancho. Que lo diga la API y no una lista de nombres escrita a
   * mano en la interfaz es lo que hace que al añadir una hoja nueva la rejilla
   * ya sepa que hacer con sus claves sin que nadie se acuerde de ir a
   * actualizarla.
   */
  | 'identificador';

/**
 * Una columna de una hoja.
 *
 * El nombre en español, el tipo y la expresion SQL que la calcula viven en el
 * MISMO sitio a proposito. Separarlos —la etiqueta en la interfaz, el SELECT
 * aqui— es garantizar que algun dia la columna "Precio de venta" enseñe el
 * precio de arriendo y nadie lo note hasta que alguien sume la cartera.
 */
export interface Columna {
  /** Identificador estable, en ascii: con el se referencia la columna. */
  key: string;
  /** Lo que lee la persona en la cabecera de la hoja. */
  label: string;
  tipo: TipoColumna;
  /** Como se calcula, con los alias del FROM de su hoja. */
  sql: string;
}

/** Lo que se manda a la interfaz: sin el SQL, que no es asunto suyo. */
export type ColumnaPublica = Omit<Columna, 'sql'>;

export interface DefinicionHoja {
  nombre: string;
  titulo: string;
  descripcion: string;
  columnas: Columna[];
  /** El FROM con sus joins y sus filtros, ya acotado por sede y por rol. */
  consulta(
    ds: DataSource,
    actor: AuthenticatedActor,
  ): SelectQueryBuilder<ObjectLiteral>;
  /** Orden estable de las filas: sin el, dos paginas pueden repetir la misma. */
  orden: [string, 'ASC' | 'DESC'][];
}

// TypeORM no exporta este tipo de forma util para lo que hace falta aqui.
type ObjectLiteral = Record<string, unknown>;

// --- utilidades de SQL ----------------------------------------------------

/**
 * Traduce un enum a castellano dentro de la propia consulta.
 *
 * Va en SQL y no en JavaScript para que ordenar por la columna ordene lo que
 * la persona ve. Los diccionarios son constantes de este archivo, nunca texto
 * de la peticion: no hay nada que inyectar.
 */
function traducido(expr: string, mapa: Record<string, string>): string {
  const casos = Object.entries(mapa)
    .map(([clave, valor]) => `WHEN '${clave}' THEN '${valor}'`)
    .join(' ');
  return `(CASE ${expr}::text ${casos} ELSE ${expr}::text END)`;
}

/** Fecha de calendario en Bogota, lista para la rejilla. */
function fecha(expr: string): string {
  return `to_char(${expr} AT TIME ZONE '${ZONA}', 'YYYY-MM-DD')`;
}

/** Fecha y hora en Bogota. La hoja no tiene que convertir husos. */
function fechaHora(expr: string): string {
  return `to_char(${expr} AT TIME ZONE '${ZONA}', 'YYYY-MM-DD HH24:MI')`;
}

/**
 * Los numeric de Postgres llegan como cadena al driver, y una cadena en una
 * celda no se suma. El casteo va en SQL para que la interfaz reciba numeros de
 * verdad sin tener que recorrer siete mil filas convirtiendo.
 */
function numero(expr: string): string {
  return `(${expr})::float8`;
}

/** El nombre completo de una persona a partir de sus dos columnas. */
function nombreCompleto(alias: string, primera = 'first_name'): string {
  return `nullif(btrim(coalesce(${alias}.${primera}, '') || ' ' || coalesce(${alias}.last_name, '')), '')`;
}

// --- diccionarios de enums ------------------------------------------------

/*
  Cada diccionario va tipado por SU enum —`Record<Availability, string>` y no
  `Record<string, string>`— para que el compilador exija que esten todos los
  valores y rechace los que no existen. La primera version de este archivo
  traducia un `PublicationStatus` inventado y la columna "Publicación" enseñaba
  "ACTIVE" en crudo sin que nada fallara: con el tipo puesto, eso no compila.
*/

const DISPONIBILIDAD: Record<Availability, string> = {
  [Availability.AVAILABLE]: 'Disponible',
  [Availability.RESERVED]: 'Reservado',
  [Availability.SOLD]: 'Vendido',
  [Availability.RENTED]: 'Arrendado',
  [Availability.WITHDRAWN]: 'Retirado',
};

const PUBLICACION: Record<PublicationStatus, string> = {
  [PublicationStatus.DRAFT]: 'Borrador',
  [PublicationStatus.ACTIVE]: 'Activo',
  [PublicationStatus.OUTSTANDING]: 'Destacado',
  [PublicationStatus.INACTIVE]: 'Inactivo',
};

const ROL_VINCULO: Record<InterestRole, string> = {
  [InterestRole.PROSPECT]: 'Interesado',
  [InterestRole.BUYER]: 'Comprador',
  [InterestRole.SELLER]: 'Vendedor',
  [InterestRole.OWNER]: 'Propietario',
  [InterestRole.TENANT]: 'Arrendatario',
};

const ESTADO_VINCULO: Record<InterestStatus, string> = {
  [InterestStatus.OPEN]: 'Abierto',
  [InterestStatus.VISITED]: 'Visitado',
  [InterestStatus.OFFER_MADE]: 'Oferta hecha',
  [InterestStatus.CLOSED_WON]: 'Cerrado ganado',
  [InterestStatus.CLOSED_LOST]: 'Cerrado perdido',
};

const TIPO_CITA: Record<AppointmentType, string> = {
  [AppointmentType.VISIT]: 'Visita',
  [AppointmentType.CALL]: 'Llamada',
  [AppointmentType.MEETING]: 'Reunión',
  [AppointmentType.SIGNING]: 'Firma',
  [AppointmentType.PHOTO_SHOOT]: 'Sesión de fotos',
  [AppointmentType.APPRAISAL]: 'Avalúo',
};

const ESTADO_CITA: Record<AppointmentStatus, string> = {
  [AppointmentStatus.SCHEDULED]: 'Agendada',
  [AppointmentStatus.CONFIRMED]: 'Confirmada',
  [AppointmentStatus.DONE]: 'Realizada',
  [AppointmentStatus.CANCELED]: 'Cancelada',
  [AppointmentStatus.NO_SHOW]: 'No asistió',
};

const CLASE_PROYECTO: Record<FamilyKind, string> = {
  [FamilyKind.PROJECT]: 'Proyecto',
  [FamilyKind.COMPLEX]: 'Conjunto',
  [FamilyKind.BUILDING]: 'Edificio',
  [FamilyKind.STAGE]: 'Etapa',
};

const ESTADO_PROYECTO: Record<FamilyStatus, string> = {
  [FamilyStatus.PLANNED]: 'En planos',
  [FamilyStatus.UNDER_CONSTRUCTION]: 'En construcción',
  [FamilyStatus.DELIVERED]: 'Entregado',
  [FamilyStatus.SOLD_OUT]: 'Vendido',
};

// --- inmuebles ------------------------------------------------------------

const INMUEBLES: DefinicionHoja = {
  nombre: 'inmuebles',
  titulo: 'Inmuebles',
  descripcion:
    'Una fila por inmueble del inventario, sin las fichas de muestra. La ' +
    'columna Id es la que enlaza con las hojas Relaciones y Citas.',
  columnas: [
    // El id va primero y en texto porque es la clave con la que se cruzan las
    // hojas: sin el, un BUSCARV entre Inmuebles y Relaciones tendria que
    // apoyarse en el titulo, y hay titulos repetidos.
    { key: 'id', label: 'Id', tipo: 'identificador', sql: 'property.id' },
    { key: 'codigo', label: 'Código', tipo: 'texto', sql: 'property.code' },
    { key: 'titulo', label: 'Título', tipo: 'texto', sql: 'property.title' },
    { key: 'tipo', label: 'Tipo', tipo: 'texto', sql: 'tipo.name' },
    { key: 'ciudad', label: 'Ciudad', tipo: 'texto', sql: 'ciudad.name' },
    { key: 'zona', label: 'Zona', tipo: 'texto', sql: 'zona.name' },
    {
      key: 'direccion',
      label: 'Dirección',
      tipo: 'texto',
      sql: 'property.address',
    },
    {
      key: 'enVenta',
      label: 'En venta',
      tipo: 'booleano',
      sql: 'property.for_sale',
    },
    {
      key: 'enArriendo',
      label: 'En arriendo',
      tipo: 'booleano',
      sql: 'property.for_rent',
    },
    {
      key: 'precioVenta',
      label: 'Precio de venta',
      tipo: 'moneda',
      sql: numero('property.sale_price'),
    },
    {
      key: 'precioArriendo',
      label: 'Precio de arriendo',
      tipo: 'moneda',
      sql: numero('property.rent_price'),
    },
    {
      key: 'administracion',
      label: 'Administración',
      tipo: 'moneda',
      sql: numero('property.maintenance_fee'),
    },
    { key: 'moneda', label: 'Moneda', tipo: 'texto', sql: 'moneda.iso' },
    {
      key: 'area',
      label: 'Área (m²)',
      tipo: 'numero',
      sql: numero('property.area'),
    },
    {
      key: 'areaConstruida',
      label: 'Área construida (m²)',
      tipo: 'numero',
      sql: numero('property.built_area'),
    },
    {
      key: 'alcobas',
      label: 'Alcobas',
      tipo: 'numero',
      sql: 'property.bedrooms',
    },
    { key: 'banos', label: 'Baños', tipo: 'numero', sql: 'property.bathrooms' },
    {
      key: 'garajes',
      label: 'Garajes',
      tipo: 'numero',
      sql: 'property.garages',
    },
    { key: 'piso', label: 'Piso', tipo: 'numero', sql: 'property.floor' },
    {
      key: 'estrato',
      label: 'Estrato',
      tipo: 'numero',
      sql: 'property.stratum',
    },
    {
      key: 'publicacion',
      label: 'Publicación',
      tipo: 'texto',
      sql: traducido('property.publication_status', PUBLICACION),
    },
    {
      key: 'disponibilidad',
      label: 'Disponibilidad',
      tipo: 'texto',
      sql: traducido('property.availability', DISPONIBILIDAD),
    },
    { key: 'etiqueta', label: 'Etiqueta', tipo: 'texto', sql: 'etiqueta.name' },
    { key: 'proyecto', label: 'Proyecto', tipo: 'texto', sql: 'proyecto.name' },
    {
      key: 'tipologia',
      label: 'Tipología',
      tipo: 'texto',
      sql: 'tipologia.name',
    },
    {
      key: 'asesor',
      label: 'Asesor',
      tipo: 'texto',
      sql: nombreCompleto('asesor'),
    },
    { key: 'sede', label: 'Sede', tipo: 'texto', sql: 'sede.name' },
    {
      key: 'visitasWeb',
      label: 'Visitas web',
      tipo: 'numero',
      sql: 'property.visits',
    },
    {
      key: 'fechaAlta',
      label: 'Fecha de alta',
      tipo: 'fecha',
      sql: fecha('property.created_at'),
    },
    {
      key: 'ultimoCambio',
      label: 'Último cambio',
      tipo: 'fecha',
      sql: fecha('property.updated_at'),
    },
  ],
  consulta(ds, actor) {
    const qb = ds
      .getRepository(Property)
      .createQueryBuilder('property')
      .leftJoin('property.propertyType', 'tipo')
      .leftJoin('property.city', 'ciudad')
      .leftJoin('property.zone', 'zona')
      .leftJoin('property.currency', 'moneda')
      .leftJoin('property.label', 'etiqueta')
      .leftJoin('property.family', 'proyecto')
      .leftJoin('property.unitType', 'tipologia')
      .leftJoin(Agent, 'asesor', 'asesor.id = property.assigned_agent_id')
      .leftJoin(Branch, 'sede', 'sede.id = property.branch_id')
      // Las fichas de muestra no son inventario: son pantallas de prueba. Una
      // sola colandose en la hoja falsea todos los consolidados.
      .where('property.is_sample = false');

    applyOwnershipScope(qb, actor, 'property.assigned_agent_id');
    applyBranchScope(qb, 'property.branch_id');
    return qb as unknown as SelectQueryBuilder<ObjectLiteral>;
  },
  orden: [['property.code', 'ASC']],
};

// --- clientes -------------------------------------------------------------

const CLIENTES: DefinicionHoja = {
  nombre: 'clientes',
  titulo: 'Clientes',
  descripcion:
    'Una fila por cliente o lead, con su embudo, su etapa y su asesor. ' +
    'Lleva datos personales: solo llega a quien ya ve esos clientes en el CRM.',
  columnas: [
    { key: 'id', label: 'Id', tipo: 'identificador', sql: 'client.id' },
    {
      key: 'nombre',
      label: 'Nombre',
      tipo: 'texto',
      sql: nombreCompleto('client'),
    },
    {
      key: 'telefono',
      label: 'Teléfono',
      tipo: 'texto',
      sql: 'client.cell_phone',
    },
    {
      key: 'telefonoFijo',
      label: 'Teléfono fijo',
      tipo: 'texto',
      sql: 'client.phone',
    },
    { key: 'correo', label: 'Correo', tipo: 'texto', sql: 'client.email' },
    { key: 'ciudad', label: 'Ciudad', tipo: 'texto', sql: 'ciudad.name' },
    /*
      Los tipos son varios por cliente y en una hoja no caben como lista: se
      concatenan. Ordenados, porque si no dos clientes con los mismos tipos en
      distinto orden serian dos valores distintos en una tabla dinamica.
    */
    {
      key: 'tipos',
      label: 'Tipos',
      tipo: 'texto',
      sql: `(SELECT string_agg(ct.name, ', ' ORDER BY ct.name)
               FROM client_client_type cct
               JOIN client_type ct ON ct.id = cct.client_type_id
              WHERE cct.client_id = client.id)`,
    },
    { key: 'fuente', label: 'Fuente', tipo: 'texto', sql: 'fuente.name' },
    {
      key: 'fuentePagada',
      label: 'Fuente pagada',
      tipo: 'booleano',
      sql: 'fuente.paid',
    },
    { key: 'embudo', label: 'Embudo', tipo: 'texto', sql: 'embudo.name' },
    { key: 'etapa', label: 'Etapa', tipo: 'texto', sql: 'etapa.name' },
    /*
      Ganado / perdido / abierto en UNA columna y no en dos booleanos: en una
      tabla dinamica una columna de tres valores da tres filas, y dos booleanos
      dan cuatro combinaciones de las que una es imposible.
    */
    {
      key: 'resultado',
      label: 'Resultado',
      tipo: 'texto',
      sql: `(CASE WHEN etapa.is_won THEN 'Ganado' WHEN etapa.is_lost THEN 'Perdido' ELSE 'Abierto' END)`,
    },
    {
      key: 'asesor',
      label: 'Asesor',
      tipo: 'texto',
      sql: nombreCompleto('asesor'),
    },
    { key: 'sede', label: 'Sede', tipo: 'texto', sql: 'sede.name' },
    {
      key: 'aceptaPublicidad',
      label: 'Acepta publicidad',
      tipo: 'booleano',
      sql: 'client.accepts_marketing',
    },
    {
      key: 'inmueblesVinculados',
      label: 'Inmuebles vinculados',
      tipo: 'numero',
      sql: `(SELECT count(*) FROM property_interest pi
              WHERE pi.client_id = client.id AND pi.deleted_at IS NULL)::int`,
    },
    {
      key: 'fechaAlta',
      label: 'Fecha de alta',
      tipo: 'fecha',
      sql: fecha('client.created_at'),
    },
    {
      key: 'fechaEtapa',
      label: 'Fecha de la etapa',
      tipo: 'fecha',
      sql: fecha('client.stage_changed_at'),
    },
    {
      key: 'ultimaGestion',
      label: 'Última gestión',
      tipo: 'fecha',
      sql: fecha('client.last_contacted_at'),
    },
  ],
  consulta(ds, actor) {
    const qb = ds
      .getRepository(Client)
      .createQueryBuilder('client')
      .leftJoin('client.pipeline', 'embudo')
      .leftJoin('client.stage', 'etapa')
      .leftJoin('client.source', 'fuente')
      .leftJoin('client.city', 'ciudad')
      .leftJoin(Agent, 'asesor', 'asesor.id = client.assigned_agent_id')
      .leftJoin(Branch, 'sede', 'sede.id = client.branch_id');

    applyOwnershipScope(qb, actor, 'client.assigned_agent_id');
    applyBranchScope(qb, 'client.branch_id');
    return qb as unknown as SelectQueryBuilder<ObjectLiteral>;
  },
  orden: [
    ['client.created_at', 'DESC'],
    ['client.id', 'DESC'],
  ],
};

// --- relaciones -----------------------------------------------------------

const RELACIONES: DefinicionHoja = {
  nombre: 'relaciones',
  titulo: 'Relaciones cliente-inmueble',
  descripcion:
    'El vínculo entre un cliente y un inmueble con su papel: comprador, ' +
    'vendedor, interesado. Es la hoja que hace que una tabla dinámica cruce ' +
    'las otras dos.',
  columnas: [
    { key: 'id', label: 'Id', tipo: 'identificador', sql: 'interes.id' },
    {
      key: 'idCliente',
      label: 'Id cliente',
      tipo: 'identificador',
      sql: 'interes.client_id',
    },
    {
      key: 'cliente',
      label: 'Cliente',
      tipo: 'texto',
      sql: nombreCompleto('client'),
    },
    {
      key: 'idInmueble',
      label: 'Id inmueble',
      tipo: 'identificador',
      sql: 'interes.property_id',
    },
    { key: 'codigo', label: 'Código', tipo: 'texto', sql: 'property.code' },
    {
      key: 'inmueble',
      label: 'Inmueble',
      tipo: 'texto',
      sql: 'property.title',
    },
    { key: 'tipo', label: 'Tipo de inmueble', tipo: 'texto', sql: 'tipo.name' },
    { key: 'ciudad', label: 'Ciudad', tipo: 'texto', sql: 'ciudad.name' },
    { key: 'zona', label: 'Zona', tipo: 'texto', sql: 'zona.name' },
    {
      key: 'rol',
      label: 'Rol',
      tipo: 'texto',
      sql: traducido('interes.role', ROL_VINCULO),
    },
    {
      key: 'estado',
      label: 'Estado',
      tipo: 'texto',
      sql: traducido('interes.status', ESTADO_VINCULO),
    },
    {
      key: 'importeOfrecido',
      label: 'Importe ofrecido',
      tipo: 'moneda',
      sql: numero('interes.offered_amount'),
    },
    {
      key: 'precioVenta',
      label: 'Precio de venta',
      tipo: 'moneda',
      sql: numero('property.sale_price'),
    },
    {
      key: 'disponibilidad',
      label: 'Disponibilidad',
      tipo: 'texto',
      sql: traducido('property.availability', DISPONIBILIDAD),
    },
    {
      key: 'asesorCliente',
      label: 'Asesor del cliente',
      tipo: 'texto',
      sql: nombreCompleto('asesorCliente'),
    },
    {
      key: 'asesorInmueble',
      label: 'Asesor del inmueble',
      tipo: 'texto',
      sql: nombreCompleto('asesorInmueble'),
    },
    { key: 'sede', label: 'Sede', tipo: 'texto', sql: 'sede.name' },
    {
      key: 'fechaAlta',
      label: 'Fecha del vínculo',
      tipo: 'fecha',
      sql: fecha('interes.created_at'),
    },
  ],
  consulta(ds, actor) {
    /*
      El vinculo no tiene sede ni dueño propios: los hereda de sus dos extremos.
      Por eso el acotado se aplica a los DOS —cliente e inmueble— con INNER
      JOIN: la fila enseña el nombre del cliente Y el titulo del inmueble, asi
      que basta que uno de los dos sea de otra oficina para que la fila filtre
      algo que quien pregunta no puede ver.
    */
    const qb = ds
      .getRepository(PropertyInterest)
      .createQueryBuilder('interes')
      .innerJoin(Client, 'client', 'client.id = interes.client_id')
      .innerJoin(
        Property,
        'property',
        'property.id = interes.property_id AND property.deleted_at IS NULL AND property.is_sample = false',
      )
      .leftJoin('property.propertyType', 'tipo')
      .leftJoin('property.city', 'ciudad')
      .leftJoin('property.zone', 'zona')
      .leftJoin(
        Agent,
        'asesorCliente',
        'asesorCliente.id = client.assigned_agent_id',
      )
      .leftJoin(
        Agent,
        'asesorInmueble',
        'asesorInmueble.id = property.assigned_agent_id',
      )
      .leftJoin(Branch, 'sede', 'sede.id = client.branch_id')
      .where('client.deleted_at IS NULL');

    /*
      La propiedad se mira por el cliente, que es de quien cuelga la gestion en
      el CRM: un asesor ve los vinculos de SUS clientes. `applyOwnershipScope`
      usa un parametro fijo, asi que solo puede aplicarse una vez por consulta.
    */
    applyOwnershipScope(qb, actor, 'client.assigned_agent_id');
    applyBranchScope(qb, 'client.branch_id');
    applyBranchScope(qb, 'property.branch_id');
    return qb as unknown as SelectQueryBuilder<ObjectLiteral>;
  },
  orden: [
    ['interes.created_at', 'DESC'],
    ['interes.id', 'DESC'],
  ],
};

// --- citas ----------------------------------------------------------------

const CITAS: DefinicionHoja = {
  nombre: 'citas',
  titulo: 'Citas',
  descripcion:
    'La agenda como filas: quién, cuándo, con qué cliente y sobre qué ' +
    'inmueble. Es el eje temporal que las otras hojas no tienen.',
  columnas: [
    { key: 'id', label: 'Id', tipo: 'identificador', sql: 'cita.id' },
    {
      key: 'tipo',
      label: 'Tipo',
      tipo: 'texto',
      sql: traducido('cita.type', TIPO_CITA),
    },
    {
      key: 'estado',
      label: 'Estado',
      tipo: 'texto',
      sql: traducido('cita.status', ESTADO_CITA),
    },
    { key: 'titulo', label: 'Título', tipo: 'texto', sql: 'cita.title' },
    {
      key: 'fecha',
      label: 'Fecha',
      tipo: 'fecha',
      sql: fecha('cita.starts_at'),
    },
    {
      key: 'inicio',
      label: 'Inicio',
      tipo: 'fechaHora',
      sql: fechaHora('cita.starts_at'),
    },
    {
      key: 'fin',
      label: 'Fin',
      tipo: 'fechaHora',
      sql: fechaHora('cita.ends_at'),
    },
    {
      key: 'duracionMin',
      label: 'Duración (min)',
      tipo: 'numero',
      sql: `(EXTRACT(EPOCH FROM (cita.ends_at - cita.starts_at)) / 60)::int`,
    },
    {
      key: 'asesor',
      label: 'Asesor',
      tipo: 'texto',
      sql: nombreCompleto('asesor'),
    },
    { key: 'sede', label: 'Sede', tipo: 'texto', sql: 'sede.name' },
    {
      key: 'idCliente',
      label: 'Id cliente',
      tipo: 'identificador',
      sql: 'cita.client_id',
    },
    {
      key: 'cliente',
      label: 'Cliente',
      tipo: 'texto',
      sql: nombreCompleto('client'),
    },
    {
      key: 'idInmueble',
      label: 'Id inmueble',
      tipo: 'identificador',
      sql: 'cita.property_id',
    },
    { key: 'codigo', label: 'Código', tipo: 'texto', sql: 'property.code' },
    {
      key: 'inmueble',
      label: 'Inmueble',
      tipo: 'texto',
      sql: 'property.title',
    },
    { key: 'lugar', label: 'Lugar', tipo: 'texto', sql: 'cita.location' },
    {
      key: 'resultado',
      label: 'Resultado',
      tipo: 'texto',
      sql: 'cita.outcome',
    },
  ],
  consulta(ds, actor) {
    const qb = ds
      .getRepository(Appointment)
      .createQueryBuilder('cita')
      .leftJoin(Agent, 'asesor', 'asesor.id = cita.agent_id')
      .leftJoin(Branch, 'sede', 'sede.id = cita.branch_id')
      .leftJoin(
        Client,
        'client',
        'client.id = cita.client_id AND client.deleted_at IS NULL',
      )
      .leftJoin(
        Property,
        'property',
        'property.id = cita.property_id AND property.deleted_at IS NULL',
      );

    applyOwnershipScope(qb, actor, 'cita.agent_id');
    applyBranchScope(qb, 'cita.branch_id');
    return qb as unknown as SelectQueryBuilder<ObjectLiteral>;
  },
  orden: [
    ['cita.starts_at', 'DESC'],
    ['cita.id', 'DESC'],
  ],
};

// --- inventario por proyecto y tipologia ----------------------------------

/**
 * Cuenta inmuebles de una tipologia con una condicion extra.
 *
 * Se acota a la sede del PROYECTO —no a la de la peticion— porque el proyecto
 * ya viene filtrado por sede: asi la cifra no puede incluir una unidad que
 * alguien movio de oficina sin mover el proyecto.
 */
function unidades(condicion = 'TRUE'): string {
  return `(SELECT count(*) FROM property p
            WHERE p.family_id = proyecto.id
              AND p.unit_type_id = tipologia.id
              AND p.branch_id = proyecto.branch_id
              AND p.deleted_at IS NULL
              AND p.is_sample = false
              AND ${condicion})::int`;
}

const INVENTARIO: DefinicionHoja = {
  nombre: 'inventario',
  titulo: 'Inventario por proyecto y tipología',
  descripcion:
    'Una fila por tipología, con los datos de su proyecto y cuántas ' +
    'unidades tiene disponibles, vendidas o arrendadas. Los proyectos sin ' +
    'tipologías salen igual, con las columnas de tipología vacías.',
  columnas: [
    {
      key: 'idProyecto',
      label: 'Id proyecto',
      tipo: 'identificador',
      sql: 'proyecto.id',
    },
    { key: 'proyecto', label: 'Proyecto', tipo: 'texto', sql: 'proyecto.name' },
    {
      key: 'clase',
      label: 'Clase',
      tipo: 'texto',
      sql: traducido('proyecto.kind', CLASE_PROYECTO),
    },
    {
      key: 'estadoProyecto',
      label: 'Estado del proyecto',
      tipo: 'texto',
      sql: traducido('proyecto.status', ESTADO_PROYECTO),
    },
    {
      key: 'constructora',
      label: 'Constructora',
      tipo: 'texto',
      sql: 'proyecto.developer',
    },
    { key: 'ciudad', label: 'Ciudad', tipo: 'texto', sql: 'ciudad.name' },
    { key: 'zona', label: 'Zona', tipo: 'texto', sql: 'zona.name' },
    {
      key: 'anioEntrega',
      label: 'Año de entrega',
      tipo: 'numero',
      sql: 'proyecto.delivery_year',
    },
    {
      key: 'unidadesDeclaradas',
      label: 'Unidades declaradas',
      tipo: 'numero',
      sql: 'proyecto.total_units',
    },
    { key: 'sede', label: 'Sede', tipo: 'texto', sql: 'sede.name' },
    {
      key: 'codigoTipologia',
      label: 'Código tipología',
      tipo: 'texto',
      sql: 'tipologia.code',
    },
    {
      key: 'tipologia',
      label: 'Tipología',
      tipo: 'texto',
      sql: 'tipologia.name',
    },
    {
      key: 'alcobas',
      label: 'Alcobas',
      tipo: 'numero',
      sql: 'tipologia.bedrooms',
    },
    {
      key: 'banos',
      label: 'Baños',
      tipo: 'numero',
      sql: 'tipologia.bathrooms',
    },
    {
      key: 'garajes',
      label: 'Garajes',
      tipo: 'numero',
      sql: 'tipologia.garages',
    },
    {
      key: 'areaMin',
      label: 'Área mínima (m²)',
      tipo: 'numero',
      sql: numero('tipologia.area_min'),
    },
    {
      key: 'areaMax',
      label: 'Área máxima (m²)',
      tipo: 'numero',
      sql: numero('tipologia.area_max'),
    },
    {
      key: 'unidades',
      label: 'Unidades',
      tipo: 'numero',
      sql: unidades(),
    },
    {
      key: 'disponibles',
      label: 'Disponibles',
      tipo: 'numero',
      sql: unidades(`p.availability = 'AVAILABLE'`),
    },
    {
      key: 'vendidas',
      label: 'Vendidas',
      tipo: 'numero',
      sql: unidades(`p.availability = 'SOLD'`),
    },
    {
      key: 'arrendadas',
      label: 'Arrendadas',
      tipo: 'numero',
      sql: unidades(`p.availability = 'RENTED'`),
    },
    {
      key: 'precioMin',
      label: 'Precio mínimo',
      tipo: 'moneda',
      sql: `(SELECT min(p.sale_price)::float8 FROM property p
              WHERE p.family_id = proyecto.id AND p.unit_type_id = tipologia.id
                AND p.branch_id = proyecto.branch_id
                AND p.deleted_at IS NULL AND p.is_sample = false)`,
    },
    {
      key: 'precioMax',
      label: 'Precio máximo',
      tipo: 'moneda',
      sql: `(SELECT max(p.sale_price)::float8 FROM property p
              WHERE p.family_id = proyecto.id AND p.unit_type_id = tipologia.id
                AND p.branch_id = proyecto.branch_id
                AND p.deleted_at IS NULL AND p.is_sample = false)`,
    },
  ],
  consulta(ds, actor) {
    /*
      La fila es la tipologia, no el proyecto, y el join es LEFT para que un
      proyecto recien creado —sin tipologias todavia— siga apareciendo. Lo que
      NO sale aqui son las unidades de un proyecto sin tipologia asignada: esas
      se cuentan en la hoja Inmuebles, que las lleva con la columna Tipología
      vacia. Duplicarlas aqui con una fila "(sin tipologia)" haria que sumar la
      columna Unidades de esta hoja y contar filas en la otra dieran cifras
      distintas del mismo inventario.

      `actor` no se usa: un proyecto no tiene asesor asignado, igual que en
      `FamiliesService`, donde el acotado es solo por sede.
    */
    void actor;
    const qb = ds
      .getRepository(PropertyFamily)
      .createQueryBuilder('proyecto')
      .leftJoin(
        UnitType,
        'tipologia',
        'tipologia.family_id = proyecto.id AND tipologia.deleted_at IS NULL',
      )
      .leftJoin('proyecto.city', 'ciudad')
      .leftJoin('proyecto.zone', 'zona')
      .leftJoin(Branch, 'sede', 'sede.id = proyecto.branch_id');

    applyBranchScope(qb, 'proyecto.branch_id');
    return qb as unknown as SelectQueryBuilder<ObjectLiteral>;
  },
  orden: [
    ['proyecto.name', 'ASC'],
    ['tipologia.position', 'ASC'],
    ['tipologia.code', 'ASC'],
  ],
};

// --- registro -------------------------------------------------------------

export const HOJAS: DefinicionHoja[] = [
  INMUEBLES,
  CLIENTES,
  RELACIONES,
  CITAS,
  INVENTARIO,
];

export const NOMBRES_HOJA = HOJAS.map((h) => h.nombre);

export function hojaPorNombre(nombre: string): DefinicionHoja | undefined {
  return HOJAS.find((h) => h.nombre === nombre);
}
