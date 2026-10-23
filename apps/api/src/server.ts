import { createApp } from './app.js';
import { connectDB } from './config/db.js';
import { env } from './config/env.js';
import { logger } from './config/logger.js';
import { seedDemoAccounts } from './utils/seedData.js';
import { scheduleRetentionJob } from './services/retentionService.js';
import { submissionQueue } from './services/queue.js';

async function startServer() {
  try {
    await connectDB();
    await seedDemoAccounts();
    scheduleRetentionJob();
    submissionQueue.start();

    const app = createApp();

    const server = app.listen(env.PORT, () => {
      logger.info(`Digital Pusher API running on port ${env.PORT} [${env.NODE_ENV}]`);
      logger.info(`OpenAPI docs available at http://localhost:${env.PORT}/api/docs`);
    });

    const shutdown = async () => {
      logger.info('Shutting down server gracefully...');
      submissionQueue.stop();
      server.close(() => {
        logger.info('Server closed');
        process.exit(0);
      });
    };

    process.on('SIGTERM', shutdown);
    process.on('SIGINT', shutdown);
  } catch (err: any) {
    logger.error({ error: err.message }, 'Fatal error during server startup');
    process.exit(1);
  }
}

startServer();
