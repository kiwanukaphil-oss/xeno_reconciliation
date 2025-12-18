import { Worker, Job } from 'bullmq';
import { connection, JobNames } from '../config/queue';
import { logger } from '../config/logger';
import { BankReconciliationService } from './reconciliation/BankReconciliationService';

/**
 * Background worker for processing bank reconciliation uploads
 */

interface BankJobData {
  batchId: string;
  filePath: string;
}

const reconciliationService = new BankReconciliationService();

// Create worker
const worker = new Worker(
  'bank-reconciliation',
  async (job: Job<BankJobData>) => {
    const { batchId, filePath } = job.data;

    logger.info(`Processing bank reconciliation job ${job.id}: ${job.name} for batch ${batchId}`);

    try {
      switch (job.name) {
        case JobNames.PROCESS_BANK_UPLOAD:
          const result = await reconciliationService.processUpload(batchId, filePath);
          logger.info(`Bank reconciliation job ${job.id} completed:`, {
            totalRecords: result.totalRecords,
            matched: result.totalMatched,
            unmatched: result.totalUnmatched,
          });
          return { success: true, ...result };

        default:
          throw new Error(`Unknown job name: ${job.name}`);
      }
    } catch (error: any) {
      logger.error(`Bank reconciliation job ${job.id} failed:`, error);
      throw error;
    }
  },
  {
    connection,
    concurrency: 2, // Process up to 2 bank files concurrently (they're heavy)
    limiter: {
      max: 5, // Max 5 jobs
      duration: 1000, // Per 1 second
    },
    lockDuration: 600000, // 10 minutes lock duration for large file processing
    lockRenewTime: 300000, // Renew lock every 5 minutes
  }
);

// Event handlers
worker.on('completed', (job) => {
  logger.info(`Bank reconciliation job ${job.id} completed`, job.returnvalue);
});

worker.on('failed', (job, err) => {
  logger.error(`Bank reconciliation job ${job?.id} failed:`, err);
});

worker.on('error', (err) => {
  logger.error('Bank reconciliation worker error:', err);
});

worker.on('progress', (job, progress) => {
  logger.info(`Bank reconciliation job ${job.id} progress: ${progress}%`);
});

// Graceful shutdown
process.on('SIGTERM', async () => {
  logger.info('SIGTERM received, closing bank worker...');
  await worker.close();
  process.exit(0);
});

process.on('SIGINT', async () => {
  logger.info('SIGINT received, closing bank worker...');
  await worker.close();
  process.exit(0);
});

logger.info('Bank reconciliation worker started');

export default worker;
