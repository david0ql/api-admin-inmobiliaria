/**
 * Para que sirve cada foto.
 *
 * Enum cerrado y no texto libre: sobre esto se ordena la galeria, se detecta lo
 * que falta ("este piso no tiene ni una foto de la cocina") y se compara una
 * version del prompt con la siguiente. Con texto libre el modelo escribiria
 * "salon", "sala", "living" y "estancia principal" y no se podria contar nada.
 *
 * Lo que el modelo devuelva y no este aqui se normaliza a `OTHER`.
 */
export enum RoomKind {
  FACADE = 'FACADE',
  LOBBY = 'LOBBY',
  LIVING = 'LIVING',
  DINING = 'DINING',
  KITCHEN = 'KITCHEN',
  BEDROOM = 'BEDROOM',
  BATHROOM = 'BATHROOM',
  STUDY = 'STUDY',
  LAUNDRY = 'LAUNDRY',
  BALCONY = 'BALCONY',
  TERRACE = 'TERRACE',
  GARDEN = 'GARDEN',
  POOL = 'POOL',
  GARAGE = 'GARAGE',
  COMMON_AREA = 'COMMON_AREA',
  GYM = 'GYM',
  VIEW = 'VIEW',
  FLOOR_PLAN = 'FLOOR_PLAN',
  EXTERIOR = 'EXTERIOR',
  DETAIL = 'DETAIL',
  OTHER = 'OTHER',
}

/** Como se llama cada estancia cuando hay que enseñarselo a una persona. */
export const ROOM_LABEL: Record<RoomKind, string> = {
  [RoomKind.FACADE]: 'Fachada',
  [RoomKind.LOBBY]: 'Portería o recibidor',
  [RoomKind.LIVING]: 'Sala',
  [RoomKind.DINING]: 'Comedor',
  [RoomKind.KITCHEN]: 'Cocina',
  [RoomKind.BEDROOM]: 'Alcoba',
  [RoomKind.BATHROOM]: 'Baño',
  [RoomKind.STUDY]: 'Estudio',
  [RoomKind.LAUNDRY]: 'Zona de ropas',
  [RoomKind.BALCONY]: 'Balcón',
  [RoomKind.TERRACE]: 'Terraza',
  [RoomKind.GARDEN]: 'Jardín',
  [RoomKind.POOL]: 'Piscina',
  [RoomKind.GARAGE]: 'Parqueadero',
  [RoomKind.COMMON_AREA]: 'Zona común',
  [RoomKind.GYM]: 'Gimnasio',
  [RoomKind.VIEW]: 'Vista',
  [RoomKind.FLOOR_PLAN]: 'Plano',
  [RoomKind.EXTERIOR]: 'Exterior',
  [RoomKind.DETAIL]: 'Detalle',
  [RoomKind.OTHER]: 'Otra',
};

/** En que estado esta el analisis de un lote. */
export enum AnalysisStatus {
  RUNNING = 'RUNNING',
  DONE = 'DONE',
  FAILED = 'FAILED',
}
