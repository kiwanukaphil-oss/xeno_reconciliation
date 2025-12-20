import express from 'express';
import cors from 'cors';
import { config } from './config/env';
import { logger } from './config/logger';
import { errorHandler, notFoundHandler } from './middleware/errorHandler';

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

const app = express();

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Request logging
app.use((req, _res, next) => {
  logger.info(`${req.method} ${req.path}`);
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



