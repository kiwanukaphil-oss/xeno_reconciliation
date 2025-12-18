import { Worker, Job } from 'bullmq';
import { connection, JobNames } from '../config/queue';
import { logger } from '../config/logger';
import { FundFileProcessor } from './fund-upload/FundFileProcessor';
import { BankFileProcessor } from './bank-upload/BankFileProcessor';

/**
 * Background worker for processing fund transaction uploads AND bank uploads
 */

interface JobData {
  batchId: string;
  filePath: string;
}

// Create worker for fund processing
const worker = new Worker(
  'fund-processing',
  async (job: Job<JobData>) => {
    const { batchId, filePath } = job.data;

    logger.info(`Processing job ${job.id}: ${job.name} for batch ${batchId}`);

    try {
      switch (job.name) {
        case JobNames.PROCESS_NEW_UPLOAD:
          await FundFileProcessor.processFile(batchId, filePath);
          break;

        case JobNames.RESUME_AFTER_APPROVAL:
          await FundFileProcessor.resumeProcessing(batchId, filePath);
          break;

        default:
          throw new Error(`Unknown job name: ${job.name}`);
      }

      logger.info(`Job ${job.id} completed successfully`);
      return { success: true, batchId };
    } catch (error: any) {
      logger.error(`Job ${job.id} failed:`, error);
      throw error;
    }
  },
  {
    connection,
    concurrency: 5, // Process up to 5 jobs concurrently
    limiter: {
      max: 10, // Max 10 jobs
      duration: 1000, // Per 1 second
    },
    lockDuration: 300000, // 5 minutes lock duration for long-running file processing
    lockRenewTime: 150000, // Renew lock every 2.5 minutes
  }
);

// Event handlers for fund worker
worker.on('completed', (job) => {
  logger.info(`Fund job ${job.id} completed`, job.returnvalue);
});

worker.on('failed', (job, err) => {
  logger.error(`Fund job ${job?.id} failed:`, err);
});

worker.on('error', (err) => {
  logger.error('Fund worker error:', err);
});

// =====================================================
// Bank Upload Worker (mirrors fund upload pattern)
// =====================================================
const bankWorker = new Worker(
  'bank-reconciliation',
  async (job: Job<JobData>) => {
    const { batchId, filePath } = job.data;

    logger.info(`Processing bank job ${job.id}: ${job.name} for batch ${batchId}`);

    try {
      switch (job.name) {
        case JobNames.PROCESS_BANK_UPLOAD:
          // Use the new BankFileProcessor (mirrors FundFileProcessor)
          await BankFileProcessor.processFile(batchId, filePath);
          logger.info(`Bank upload job ${job.id} completed for batch ${batchId}`);
          return { success: true, batchId };

        default:
          throw new Error(`Unknown bank job name: ${job.name}`);
      }
    } catch (error: any) {
      logger.error(`Bank job ${job.id} failed:`, error);
      throw error;
    }
  },
  {
    connection,
    concurrency: 2, // Process up to 2 bank files concurrently
    lockDuration: 600000, // 10 minutes lock duration for large file processing
    lockRenewTime: 300000, // Renew lock every 5 minutes
  }
);

// Event handlers for bank worker
bankWorker.on('completed', (job) => {
  logger.info(`Bank job ${job.id} completed`, job.returnvalue);
});

bankWorker.on('failed', (job, err) => {
  logger.error(`Bank job ${job?.id} failed:`, err);
});

bankWorker.on('error', (err) => {
  logger.error('Bank worker error:', err);
});

// Graceful shutdown
process.on('SIGTERM', async () => {
  logger.info('SIGTERM received, closing workers...');
  await Promise.all([worker.close(), bankWorker.close()]);
  process.exit(0);
});

process.on('SIGINT', async () => {
  logger.info('SIGINT received, closing workers...');
  await Promise.all([worker.close(), bankWorker.close()]);
  process.exit(0);
});

logger.info('Fund processing worker started');
logger.info('Bank reconciliation worker started');

export default worker;
