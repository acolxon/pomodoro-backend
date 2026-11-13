import { MigrationInterface } from 'typeorm';
import { InitFoundation1794614400000 } from './1794614400000-InitFoundation';

/**
 * Реестр миграций. Каждая новая миграция ОБЯЗАТЕЛЬНО добавляется сюда
 * (явный список надёжнее glob-паттернов при запуске из ts-node, jest и dist).
 */
export const ALL_MIGRATIONS: Array<new () => MigrationInterface> = [InitFoundation1794614400000];
