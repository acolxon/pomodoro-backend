import { DefaultNamingStrategy, NamingStrategyInterface } from 'typeorm';

export function toSnakeCase(value: string): string {
  return value
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/([A-Z])([A-Z][a-z])/g, '$1_$2')
    .toLowerCase();
}

/**
 * Свойства сущностей в camelCase (createdAt) хранятся в БД в snake_case (created_at).
 * Имена таблиц задаются явно в @Entity('...').
 */
export class SnakeNamingStrategy extends DefaultNamingStrategy implements NamingStrategyInterface {
  columnName(propertyName: string, customName: string, embeddedPrefixes: string[]): string {
    const name = customName ? customName : toSnakeCase(propertyName);
    return embeddedPrefixes.length > 0 ? `${toSnakeCase(embeddedPrefixes.join('_'))}_${name}` : name;
  }

  joinColumnName(relationName: string, referencedColumnName: string): string {
    return toSnakeCase(`${relationName}_${referencedColumnName}`);
  }
}
