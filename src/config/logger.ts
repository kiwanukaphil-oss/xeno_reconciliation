import winston from 'winston';
import { config } from './env';
import path from 'path';
import fs from 'fs';
import { getRequestId } from '../middleware/requestId';

// Ensure logs directory exists
const logDir = path.dirname(config.logging.file);
if (!fs.existsSync(logDir)) {
  fs.mkdirSync(logDir, { recursive: true });
}

// Custom format to add request ID to all log entries
const addRequestId = winston.format((info) => {
  info.requestId = getRequestId();
  return info;
});

// Define log format with request ID
const logFormat = winston.format.combine(
  addRequestId(),
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.errors({ stack: true }),
  winston.format.splat(),
  winston.format.json()
);

// Create console format for development with request ID
const consoleFormat = winston.format.combine(
  addRequestId(),
  winston.format.colorize(),
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.printf((info) => {
    const { level, message, timestamp, requestId, ...metadata } = info;
    const reqId = requestId as string;
    const reqIdPart = reqId && reqId !== 'no-context' ? `[${reqId.slice(0, 8)}]` : '';
    let msg = `${timestamp} ${reqIdPart}[${level}] ${message}`;
    if (Object.keys(metadata).length > 0) {
      msg += ` ${JSON.stringify(metadata)}`;
    }
    return msg;
  })
);

// Create logger
export const logger = winston.createLogger({
  level: config.logging.level,
  format: logFormat,
  transports: [
    // File transport for all logs
    new winston.transports.File({
      filename: config.logging.file,
      maxsize: 10 * 1024 * 1024, // 10MB
      maxFiles: 5,
    }),
    // Separate file for errors
    new winston.transports.File({
      filename: path.join(logDir, 'error.log'),
      level: 'error',
      maxsize: 10 * 1024 * 1024,
      maxFiles: 5,
    }),
  ],
});

// Add console transport in development
if (config.nodeEnv === 'development') {
  logger.add(
    new winston.transports.Console({
      format: consoleFormat,
    })
  );
}

export default logger;
