import { Queue, QueueOptions } from 'bullmq';
import IORedis from 'ioredis';
import { config } from './env';

// Create Redis connection
const connection = new IORedis({
  host: config.redis.host,
  port: config.redis.port,
  password: config.redis.password,
  maxRetriesPerRequest: null, // Required for BullMQ
});

// Queue options
const queueOptions: QueueOptions = {
  connection,
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 2000,
    },
    removeOnComplete: {
      count: 100, // Keep last 100 completed jobs
      age: 24 * 3600, // Keep for 24 hours
    },
    removeOnFail: {
      count: 500, // Keep last 500 failed jobs
      age: 7 * 24 * 3600, // Keep for 7 days
    },
  },
};

// Create fund processing queue
export const fundProcessingQueue = new Queue('fund-processing', queueOptions);

// Job names
export const JobNames = {
  PROCESS_NEW_UPLOAD: 'process-new-upload',
  RESUME_AFTER_APPROVAL: 'resume-after-approval',
} as const;

export type JobName = (typeof JobNames)[keyof typeof JobNames];

// Export connection for worker
export { connection };
