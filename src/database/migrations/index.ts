import { MigrationInterface } from 'typeorm';
import { InitFoundation1794614400000 } from './1794614400000-InitFoundation';
import { Rooms1794700800000 } from './1794700800000-Rooms';
import { PomodoroSessions1794787200000 } from './1794787200000-PomodoroSessions';
import { TasksAndHistory1794873600000 } from './1794873600000-TasksAndHistory';
import { HistoryRoomNames1794960000000 } from './1794960000000-HistoryRoomNames';
import { FocusRewards1795046400000 } from './1795046400000-FocusRewards';
import { SessionReadiness1795132800000 } from './1795132800000-SessionReadiness';
import { XpBoosterShop1795219200000 } from './1795219200000-XpBoosterShop';

/**
 * Реестр миграций. Каждая новая миграция ОБЯЗАТЕЛЬНО добавляется сюда
 * (явный список надёжнее glob-паттернов при запуске из ts-node, jest и dist).
 */
export const ALL_MIGRATIONS: Array<new () => MigrationInterface> = [
  InitFoundation1794614400000,
  Rooms1794700800000,
  PomodoroSessions1794787200000,
  TasksAndHistory1794873600000,
  HistoryRoomNames1794960000000,
  FocusRewards1795046400000,
  SessionReadiness1795132800000,
  XpBoosterShop1795219200000,
];
