import { getPool, closePool } from './infrastructure/db/client';
import { createApp } from './api/app';
import { logger } from './infrastructure/logger';

const PORT = parseInt(process.env.PORT ?? '3000', 10);

async function main(): Promise<void> {
  const pool = getPool();

  // Проверяем соединение
  const client = await pool.connect();
  client.release();

  const app = createApp(pool);

  const server = app.listen(PORT, () => {
    logger.info('server_started', { port: PORT });
  });

  const shutdown = async (): Promise<void> => {
    logger.info('server_shutting_down');
    server.close(async () => {
      await closePool();
      process.exit(0);
    });
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

main().catch((err) => {
  logger.error('startup_error', { message: err.message, stack: err.stack });
  process.exit(1);
});
