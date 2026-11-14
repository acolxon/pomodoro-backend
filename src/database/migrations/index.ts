import { MigrationInterface } from 'typeorm';
import { InitFoundation1794614400000 } from './1794614400000-InitFoundation';
import { Rooms1794700800000 } from './1794700800000-Rooms';
import { PomodoroSessions1794787200000 } from './1794787200000-PomodoroSessions';
import { TasksAndHistory1794873600000 } from './1794873600000-TasksAndHistory';

/**
 * Реестр миграций. Каждая новая миграция ОБЯЗАТЕЛЬНО добавляется сюда
 * (явный список надёжнее glob-паттернов при запуске из ts-node, jest и dist).
 */
export const ALL_MIGRATIONS: Array<new () => MigrationInterface> = [
  InitFoundation1794614400000,
  Rooms1794700800000,
  PomodoroSessions1794787200000,
  TasksAndHistory1794873600000,
];
