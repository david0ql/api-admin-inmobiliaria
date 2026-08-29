import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { Role, seesEverything } from '../iam/domain/role.enum';
import { RequestContext } from '../../shared/request-context/request-context';
import type { AuthenticatedActor } from '../../shared/request-context/request-context';

// Las filas de agregacion no corresponden a ninguna entidad, asi que se
// declaran aqui: `DataSource.query` devuelve `any` y sin estos tipos el
// resultado se propagaria sin comprobar hasta el controlador.
export interface InventorySummary {
  total: number;
  available: number;
  sold: number;
  rented: number;
  published: number;
  avg_sale_price: string;
  portfolio_value: string;
  avg_area: string;
  total_visits: number;
}

export interface ClientSummary {
  total: number;
  won: number;
  lost: number;
  open: number;
  new_last_30d: number;
  stale: number;
}

export interface AppointmentSummary {
  today: number;
  upcoming_7d: number;
  no_shows_90d: number;
}

export interface CityInventoryRow {
  city_id: number;
  city: string;
  total: number;
  available: number;
  avg_price: string;
}

export interface TypeInventoryRow {
  type_id: number;
  type: string;
  total: number;
  avg_price: string;
  avg_area: string;
}

export interface FunnelRow {
  pipeline: string;
  stage_id: string;
  stage: string;
  position: number;
  color: string;
  is_won: boolean;
  is_lost: boolean;
  total: number;
  new_last_30d: number;
  avg_days_in_stage: string;
}

export interface SourceRow {
  source: string;
  paid: boolean | null;
  total: number;
  won: number;
  lost: number;
  conversion_rate: string | null;
  new_last_30d: number;
}

export interface AgentWorkloadRow {
  agent_id: string;
  agent: string;
  role: string;
  status: string;
  properties: number;
  clients: number;
  open_clients: number;
  won_clients: number;
  upcoming_appointments: number;
  activities_30d: number;
}

export interface AttentionRow {
  id: string;
  code: string;
  title: string;
  visits: number;
  sale_price: string | null;
  city: string;
  interests: number;
  portals: number;
}

/**
 * Lecturas agregadas para el panel.
 *
 * Va contra SQL directo a proposito: son consultas de agregacion pura, y
 * armarlas con el ORM solo anadiria capas sin ganar nada. No tiene entidades
 * propias — no hay ningun dato que este modulo posea.
 */
@Injectable()
export class AnalyticsService {
  constructor(@InjectDataSource() private readonly db: DataSource) {}

  /** `DataSource.query` devuelve `any`; se estrecha en un unico sitio. */
  private async rows<T>(sql: string, params: unknown[] = []): Promise<T[]> {
    return await this.db.query(sql, params);
  }

  /**
   * Filtro de visibilidad de una consulta agregada.
   *
   * Son dos recortes que se suman y que responden a preguntas distintas: un
   * AGENT solo cuenta lo suyo (`ownerColumn`), y quien pertenece a una sede
   * solo cuenta lo de su oficina (`branchColumn`). Esto ultimo es lo que hace
   * util el panel de un coordinador: sin ello lee las cifras de la empresa
   * entera y cree que son las de su sede.
   *
   * Los parametros van posicionales porque estas consultas son SQL a pelo: se
   * numeran segun se anaden, y por eso se devuelven junto al fragmento.
   */
  private scope(
    actor: AuthenticatedActor,
    ownerColumn: string,
    branchColumn?: string,
  ): { sql: string; params: unknown[] } {
    const params: unknown[] = [];
    let sql = '';

    if (!seesEverything(actor.role as Role)) {
      params.push(actor.id);
      sql += ` AND ${ownerColumn} = $${params.length}`;
    }

    const branchId = RequestContext.branchId();
    if (branchId && branchColumn) {
      params.push(branchId);
      sql += ` AND ${branchColumn} = $${params.length}`;
    }

    return { sql, params };
  }

  async overview(actor: AuthenticatedActor) {
    const s = this.scope(actor, 'p.assigned_agent_id', 'p.branch_id');
    const c = this.scope(actor, 'c.assigned_agent_id', 'c.branch_id');
    const a = this.scope(actor, 'a.agent_id', 'a.branch_id');

    const [inventory] = await this.rows<InventorySummary>(
      `SELECT
         COUNT(*)::int                                                        AS total,
         COUNT(*) FILTER (WHERE p.availability = 'AVAILABLE')::int            AS available,
         COUNT(*) FILTER (WHERE p.availability = 'SOLD')::int                 AS sold,
         COUNT(*) FILTER (WHERE p.availability = 'RENTED')::int               AS rented,
         COUNT(*) FILTER (WHERE p.publication_status IN ('ACTIVE','OUTSTANDING'))::int AS published,
         COALESCE(AVG(p.sale_price) FILTER (WHERE p.sale_price > 0), 0)::bigint AS avg_sale_price,
         COALESCE(SUM(p.sale_price) FILTER (WHERE p.availability = 'AVAILABLE'), 0)::bigint AS portfolio_value,
         COALESCE(AVG(p.area) FILTER (WHERE p.area > 0), 0)::numeric(12,1)    AS avg_area,
         COALESCE(SUM(p.visits), 0)::int                                      AS total_visits
       FROM property p
       WHERE p.deleted_at IS NULL${s.sql}`,
      s.params,
    );

    const [clients] = await this.rows<ClientSummary>(
      `SELECT
         COUNT(*)::int                                                     AS total,
         COUNT(*) FILTER (WHERE st.is_won)::int                            AS won,
         COUNT(*) FILTER (WHERE st.is_lost)::int                           AS lost,
         COUNT(*) FILTER (WHERE NOT st.is_won AND NOT st.is_lost)::int     AS open,
         COUNT(*) FILTER (WHERE c.created_at > now() - interval '30 days')::int AS new_last_30d,
         COUNT(*) FILTER (
           WHERE NOT st.is_won AND NOT st.is_lost
             AND (c.last_contacted_at IS NULL OR c.last_contacted_at < now() - interval '30 days')
         )::int                                                            AS stale
       FROM client c
       JOIN pipeline_stage st ON st.id = c.stage_id
       WHERE c.deleted_at IS NULL${c.sql}`,
      c.params,
    );

    const [appointments] = await this.rows<AppointmentSummary>(
      `SELECT
         COUNT(*) FILTER (WHERE a.starts_at::date = CURRENT_DATE)::int      AS today,
         COUNT(*) FILTER (
           WHERE a.starts_at BETWEEN now() AND now() + interval '7 days'
             AND a.status IN ('SCHEDULED','CONFIRMED')
         )::int                                                            AS upcoming_7d,
         COUNT(*) FILTER (WHERE a.status = 'NO_SHOW'
                            AND a.starts_at > now() - interval '90 days')::int AS no_shows_90d
       FROM appointment a
       WHERE a.deleted_at IS NULL${a.sql}`,
      a.params,
    );

    return { inventory, clients, appointments };
  }

  /** Inventario cruzado por ciudad y estado: donde esta el stock. */
  async inventoryByCity(
    actor: AuthenticatedActor,
  ): Promise<CityInventoryRow[]> {
    const s = this.scope(actor, 'p.assigned_agent_id', 'p.branch_id');
    return this.rows<CityInventoryRow>(
      `SELECT
         ci.id                                                       AS city_id,
         ci.name                                                     AS city,
         COUNT(*)::int                                               AS total,
         COUNT(*) FILTER (WHERE p.availability = 'AVAILABLE')::int   AS available,
         COALESCE(AVG(p.sale_price) FILTER (WHERE p.sale_price > 0), 0)::bigint AS avg_price
       FROM property p
       JOIN city ci ON ci.id = p.city_id
       WHERE p.deleted_at IS NULL${s.sql}
       GROUP BY ci.id, ci.name
       ORDER BY total DESC`,
      s.params,
    );
  }

  async inventoryByType(
    actor: AuthenticatedActor,
  ): Promise<TypeInventoryRow[]> {
    const s = this.scope(actor, 'p.assigned_agent_id', 'p.branch_id');
    return this.rows<TypeInventoryRow>(
      `SELECT
         pt.id                                                       AS type_id,
         pt.name                                                     AS type,
         COUNT(*)::int                                               AS total,
         COALESCE(AVG(p.sale_price) FILTER (WHERE p.sale_price > 0), 0)::bigint AS avg_price,
         COALESCE(AVG(p.area) FILTER (WHERE p.area > 0), 0)::numeric(12,1)      AS avg_area
       FROM property p
       JOIN property_type pt ON pt.id = p.property_type_id
       WHERE p.deleted_at IS NULL${s.sql}
       GROUP BY pt.id, pt.name
       ORDER BY total DESC`,
      s.params,
    );
  }

  /** Embudo por etapa. Es lo que WASI no permitia calcular. */
  async funnel(
    actor: AuthenticatedActor,
    pipelineId?: string,
  ): Promise<FunnelRow[]> {
    const params: unknown[] = [];
    let where = 'c.deleted_at IS NULL';

    if (pipelineId) {
      params.push(pipelineId);
      where += ` AND c.pipeline_id = $${params.length}`;
    }
    if (!seesEverything(actor.role as Role)) {
      params.push(actor.id);
      where += ` AND c.assigned_agent_id = $${params.length}`;
    }
    const sede = RequestContext.branchId();
    if (sede) {
      params.push(sede);
      where += ` AND c.branch_id = $${params.length}`;
    }

    return this.rows<FunnelRow>(
      `SELECT
         pl.name                                                     AS pipeline,
         st.id                                                       AS stage_id,
         st.name                                                     AS stage,
         st.position                                                 AS position,
         st.color                                                    AS color,
         st.is_won                                                   AS is_won,
         st.is_lost                                                  AS is_lost,
         COUNT(c.id)::int                                            AS total,
         COUNT(c.id) FILTER (WHERE c.created_at > now() - interval '30 days')::int AS new_last_30d,
         COALESCE(AVG(EXTRACT(EPOCH FROM (now() - c.stage_changed_at)) / 86400), 0)::numeric(10,1) AS avg_days_in_stage
       FROM pipeline_stage st
       JOIN pipeline pl ON pl.id = st.pipeline_id
       LEFT JOIN client c ON c.stage_id = st.id AND ${where}
       GROUP BY pl.name, pl.position, st.id, st.name, st.position, st.color, st.is_won, st.is_lost
       ORDER BY pl.position, st.position`,
      params,
    );
  }

  /**
   * Atribucion por canal. Con 4.857 de 7.529 leads viniendo de Proppit, saber
   * cuantos de ellos convierten decide si ese contrato se renueva.
   */
  async sources(actor: AuthenticatedActor): Promise<SourceRow[]> {
    const c = this.scope(actor, 'c.assigned_agent_id', 'c.branch_id');
    return this.rows<SourceRow>(
      `SELECT
         COALESCE(ls.name, 'Sin origen')                             AS source,
         ls.paid                                                     AS paid,
         COUNT(*)::int                                               AS total,
         COUNT(*) FILTER (WHERE st.is_won)::int                      AS won,
         COUNT(*) FILTER (WHERE st.is_lost)::int                     AS lost,
         ROUND(
           100.0 * COUNT(*) FILTER (WHERE st.is_won) / NULLIF(COUNT(*), 0), 2
         )                                                           AS conversion_rate,
         COUNT(*) FILTER (WHERE c.created_at > now() - interval '30 days')::int AS new_last_30d
       FROM client c
       JOIN pipeline_stage st ON st.id = c.stage_id
       LEFT JOIN lead_source ls ON ls.id = c.source_id
       WHERE c.deleted_at IS NULL${c.sql}
       GROUP BY ls.name, ls.paid
       ORDER BY total DESC`,
      c.params,
    );
  }

  /** Carga y resultados por asesor. Solo lo ve quien coordina. */
  async agentWorkload(): Promise<AgentWorkloadRow[]> {
    // El coordinador compara a los SUYOS. Basta con acotar el equipo: cada
    // asesor pertenece a una sola sede y sus cifras se cuentan por asesor.
    const sede = RequestContext.branchId();
    return this.rows<AgentWorkloadRow>(
      `SELECT
         a.id                                                        AS agent_id,
         TRIM(CONCAT(a.first_name, ' ', COALESCE(a.last_name, ''))) AS agent,
         a.role                                                      AS role,
         a.status                                                    AS status,
         (SELECT COUNT(*) FROM property p
            WHERE p.assigned_agent_id = a.id AND p.deleted_at IS NULL)::int  AS properties,
         (SELECT COUNT(*) FROM client c
            WHERE c.assigned_agent_id = a.id AND c.deleted_at IS NULL)::int  AS clients,
         (SELECT COUNT(*) FROM client c
            JOIN pipeline_stage st ON st.id = c.stage_id
            WHERE c.assigned_agent_id = a.id AND c.deleted_at IS NULL
              AND NOT st.is_won AND NOT st.is_lost)::int                     AS open_clients,
         (SELECT COUNT(*) FROM client c
            JOIN pipeline_stage st ON st.id = c.stage_id
            WHERE c.assigned_agent_id = a.id AND c.deleted_at IS NULL
              AND st.is_won)::int                                            AS won_clients,
         (SELECT COUNT(*) FROM appointment ap
            WHERE ap.agent_id = a.id AND ap.deleted_at IS NULL
              AND ap.starts_at BETWEEN now() AND now() + interval '7 days')::int AS upcoming_appointments,
         (SELECT COUNT(*) FROM activity ac
            WHERE ac.agent_id = a.id AND ac.deleted_at IS NULL
              AND ac.occurred_at > now() - interval '30 days')::int          AS activities_30d
       FROM agent a
       WHERE a.deleted_at IS NULL${sede ? ' AND a.branch_id = $1' : ''}
       ORDER BY clients DESC`,
      sede ? [sede] : [],
    );
  }

  /** Inmuebles con mas visitas y sin ningun interesado: el anuncio no convierte. */
  async attentionNeeded(actor: AuthenticatedActor): Promise<AttentionRow[]> {
    const s = this.scope(actor, 'p.assigned_agent_id', 'p.branch_id');
    return this.rows<AttentionRow>(
      `SELECT
         p.id, p.code, p.title, p.visits,
         p.sale_price::bigint AS sale_price,
         ci.name AS city,
         (SELECT COUNT(*) FROM property_interest pi WHERE pi.property_id = p.id)::int AS interests,
         (SELECT COUNT(*) FROM property_publication pp WHERE pp.property_id = p.id)::int AS portals
       FROM property p
       JOIN city ci ON ci.id = p.city_id
       WHERE p.deleted_at IS NULL
         AND p.availability = 'AVAILABLE'
         AND p.publication_status IN ('ACTIVE','OUTSTANDING')
         AND NOT EXISTS (SELECT 1 FROM property_interest pi WHERE pi.property_id = p.id)${s.sql}
       ORDER BY p.visits DESC
       LIMIT 25`,
      s.params,
    );
  }
}
