import { DefaultNamingStrategy, NamingStrategyInterface, Table } from 'typeorm';

/** `assignedAgentId` -> `assigned_agent_id`, `url360` -> `url_360`. */
function snake(input: string): string {
  return input
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1_$2')
    .replace(/([a-z])(\d)/g, '$1_$2')
    .toLowerCase();
}

/**
 * Nombres en snake_case para tablas, columnas, indices y claves.
 *
 * Postgres pliega a minusculas cualquier identificador sin comillas, asi que
 * dejar los nombres en camelCase obliga a entrecomillarlos en toda consulta
 * escrita a mano. Como los agregados del panel van en SQL directo, unificar
 * aqui evita ese ruido — y hace que el esquema sea legible desde psql.
 */
export class SnakeNamingStrategy
  extends DefaultNamingStrategy
  implements NamingStrategyInterface
{
  tableName(className: string, customName?: string): string {
    return customName || snake(className);
  }

  columnName(
    propertyName: string,
    customName: string,
    embeddedPrefixes: string[],
  ): string {
    const prefix = embeddedPrefixes.map(snake).join('_');
    const name = customName || snake(propertyName);
    return prefix ? `${prefix}_${name}` : name;
  }

  relationName(propertyName: string): string {
    return snake(propertyName);
  }

  joinColumnName(relationName: string, referencedColumnName: string): string {
    return snake(`${relationName}_${referencedColumnName}`);
  }

  joinTableName(
    firstTableName: string,
    secondTableName: string,
    firstPropertyName: string,
  ): string {
    return snake(
      `${firstTableName}_${firstPropertyName.replace(/\./gi, '_')}_${secondTableName}`,
    );
  }

  joinTableColumnName(
    tableName: string,
    propertyName: string,
    columnName?: string,
  ): string {
    return snake(`${tableName}_${columnName || propertyName}`);
  }

  classTableInheritanceParentColumnName(
    parentTableName: unknown,
    parentTableIdPropertyName: unknown,
  ): string {
    return snake(
      `${parentTableName as string}_${parentTableIdPropertyName as string}`,
    );
  }

  eagerJoinRelationAlias(alias: string, propertyPath: string): string {
    return `${alias}__${propertyPath.replace('.', '_')}`;
  }

  // Nombres deterministas para restricciones e indices: sin esto TypeORM genera
  // hashes que cambian entre entornos y ensucian los diffs de migracion.
  primaryKeyName(tableOrName: Table | string, columnNames: string[]): string {
    return `pk_${table(tableOrName)}_${columnNames.join('_')}`.slice(0, 63);
  }

  foreignKeyName(tableOrName: Table | string, columnNames: string[]): string {
    return `fk_${table(tableOrName)}_${columnNames.join('_')}`.slice(0, 63);
  }

  indexName(tableOrName: Table | string, columnNames: string[]): string {
    return `idx_${table(tableOrName)}_${columnNames.join('_')}`.slice(0, 63);
  }

  uniqueConstraintName(
    tableOrName: Table | string,
    columnNames: string[],
  ): string {
    return `uq_${table(tableOrName)}_${columnNames.join('_')}`.slice(0, 63);
  }
}

function table(tableOrName: Table | string): string {
  return typeof tableOrName === 'string' ? tableOrName : tableOrName.name;
}
