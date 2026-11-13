/* Создаёт тестовую базу (например, tomato_test), если её ещё нет.
 * Подключается к служебной БД "postgres" с теми же логином и паролем, что в .env. */
const path = require('path');
const dotenv = require('dotenv');
const { Client } = require('pg');

module.exports = async () => {
  const root = path.resolve(__dirname, '..', '..');
  // dotenv не перезаписывает уже заданные переменные: .env.test приоритетнее .env
  dotenv.config({ path: path.join(root, '.env.test') });
  dotenv.config({ path: path.join(root, '.env') });

  const dbName = process.env.DB_NAME;
  if (!dbName || !/^[A-Za-z0-9_]+$/.test(dbName) || !dbName.endsWith('_test')) {
    throw new Error(
      `Для e2e-тестов имя БД должно заканчиваться на "_test" (сейчас: "${dbName}"). ` +
        'Это защита от случайной очистки рабочей базы.',
    );
  }

  const client = new Client({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT || 5432),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: 'postgres',
  });

  try {
    await client.connect();
  } catch (error) {
    throw new Error(
      'Не удалось подключиться к PostgreSQL. Запущен ли контейнер (docker compose up -d) ' +
        'и совпадают ли DB_* в backend/.env? Исходная ошибка: ' +
        (error && error.message ? error.message : error),
    );
  }

  try {
    const result = await client.query('SELECT 1 FROM pg_database WHERE datname = $1', [dbName]);
    if (result.rowCount === 0) {
      await client.query(`CREATE DATABASE "${dbName}"`);
    }
  } finally {
    await client.end();
  }
};
