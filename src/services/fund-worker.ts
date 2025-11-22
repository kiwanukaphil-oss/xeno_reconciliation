import { Worker, Job } from 'bullmq';
import { connection, JobNames } from '../config/queue';
import { logger } from '../config/logger';
import { FundFileProcessor } from './fund-upload/FundFileProcessor';

/**
 * Background worker for processing fund transaction uploads
 */

interface JobData {
  batchId: string;
  filePath: string;
}

// Create worker
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

// Event handlers
worker.on('completed', (job) => {
  logger.info(`Job ${job.id} completed`, job.returnvalue);
});

worker.on('failed', (job, err) => {
  logger.error(`Job ${job?.id} failed:`, err);
});

worker.on('error', (err) => {
  logger.error('Worker error:', err);
});

// Graceful shutdown
process.on('SIGTERM', async () => {
  logger.info('SIGTERM received, closing worker...');
  await worker.close();
  process.exit(0);
});

process.on('SIGINT', async () => {
  logger.info('SIGINT received, closing worker...');
  await worker.close();
  process.exit(0);
});

logger.info('Fund processing worker started');

export default worker;
