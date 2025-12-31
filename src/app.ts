import express from 'express';
import cors from 'cors';
import { config } from './config/env';
import { logger } from './config/logger';
import { errorHandler, notFoundHandler } from './middleware/errorHandler';
import { requestIdMiddleware } from './middleware/requestId';

// Import routes
import fundUploadRoutes from './routes/fundUploadRoutes';
import goalTransactionRoutes from './routes/goalTransactionRoutes';
import fundTransactionRoutes from './routes/fundTransactionRoutes';
import fundPriceRoutes from './routes/fundPriceRoutes';
import unitRegistryRoutes from './routes/unitRegistryRoutes';
import dashboardRoutes from './routes/dashboardRoutes';
import bankReconciliationRoutes from './routes/bankReconciliationRoutes';
import bankUploadRoutes from './routes/bankUploadRoutes';
import goalComparisonRoutes from './routes/goalComparisonRoutes';
import varianceResolutionRoutes from './routes/varianceResolutionRoutes';

const app = express();

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Request ID middleware - must be before request logging
app.use(requestIdMiddleware);

// Request logging with request ID and response timing
app.use((req, res, next) => {
  const start = Date.now();
  logger.info(`${req.method} ${req.path} started`);

  // Log response when finished
  res.on('finish', () => {
    const duration = Date.now() - start;
    logger.info(`${req.method} ${req.path} completed`, {
      statusCode: res.statusCode,
      duration: `${duration}ms`,
    });
  });

  next();
});

// Health check
app.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
  });
});

// API Routes
app.use('/api/fund-upload', fundUploadRoutes);
app.use('/api/goal-transactions', goalTransactionRoutes);
app.use('/api/fund-transactions', fundTransactionRoutes);
app.use('/api/fund-prices', fundPriceRoutes);
app.use('/api/unit-registry', unitRegistryRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/bank-reconciliation', bankReconciliationRoutes);
app.use('/api/bank-upload', bankUploadRoutes);
app.use('/api/goal-comparison', goalComparisonRoutes);
app.use('/api/variance-resolution', varianceResolutionRoutes);

// 404 handler
app.use(notFoundHandler);

// Error handler
app.use(errorHandler);

// Start server
const PORT = config.port;

app.listen(PORT, () => {
  logger.info(`Server running on port ${PORT}`);
  logger.info(`Environment: ${config.nodeEnv}`);
  logger.info(`Upload directory: ${config.upload.directory}`);
});

export default app;



