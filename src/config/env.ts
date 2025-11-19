import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

interface EnvConfig {
  // Database
  databaseUrl: string;

  // Redis
  redis: {
    host: string;
    port: number;
    password?: string;
  };

  // Server
  port: number;
  nodeEnv: string;

  // File Upload
  upload: {
    directory: string;
    maxFileSizeMB: number;
  };

  // Processing
  processing: {
    batchInsertSize: number;
    maxConcurrentJobs: number;
  };

  // Validation
  validation: {
    dateRangeYearsPast: number;
    dateRangeYearsFuture: number;
    amountMin: number;
    amountMax: number;
    unitTrustTolerance: number;
    fundDistributionTolerance: number;
  };

  // Logging
  logging: {
    level: string;
    file: string;
  };
}

function getEnvVar(key: string, defaultValue?: string): string {
  const value = process.env[key] || defaultValue;
  if (!value) {
    throw new Error(`Environment variable ${key} is required but not set`);
  }
  return value;
}

function getEnvNumber(key: string, defaultValue: number): number {
  const value = process.env[key];
  return value ? parseInt(value, 10) : defaultValue;
}

function getEnvFloat(key: string, defaultValue: number): number {
  const value = process.env[key];
  return value ? parseFloat(value) : defaultValue;
}

export const config: EnvConfig = {
  databaseUrl: getEnvVar('DATABASE_URL'),

  redis: {
    host: getEnvVar('REDIS_HOST', 'localhost'),
    port: getEnvNumber('REDIS_PORT', 6379),
    password: process.env.REDIS_PASSWORD || undefined,
  },

  port: getEnvNumber('PORT', 3000),
  nodeEnv: getEnvVar('NODE_ENV', 'development'),

  upload: {
    directory: getEnvVar('UPLOAD_DIR', 'uploads/temp'),
    maxFileSizeMB: getEnvNumber('MAX_FILE_SIZE_MB', 100),
  },

  processing: {
    batchInsertSize: getEnvNumber('BATCH_INSERT_SIZE', 500),
    maxConcurrentJobs: getEnvNumber('MAX_CONCURRENT_JOBS', 5),
  },

  validation: {
    dateRangeYearsPast: getEnvNumber('DATE_RANGE_YEARS_PAST', 10),
    dateRangeYearsFuture: getEnvNumber('DATE_RANGE_YEARS_FUTURE', 0),
    amountMin: getEnvNumber('AMOUNT_MIN', 1000),
    amountMax: getEnvNumber('AMOUNT_MAX', 1000000000),
    unitTrustTolerance: getEnvFloat('UNIT_TRUST_TOLERANCE', 0.01),
    fundDistributionTolerance: getEnvFloat('FUND_DISTRIBUTION_TOLERANCE', 0.01),
  },

  logging: {
    level: getEnvVar('LOG_LEVEL', 'info'),
    file: getEnvVar('LOG_FILE', 'logs/app.log'),
  },
};

export const isDevelopment = config.nodeEnv === 'development';
export const isProduction = config.nodeEnv === 'production';
export const isTest = config.nodeEnv === 'test';
