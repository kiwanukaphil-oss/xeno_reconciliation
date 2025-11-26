import { Router, Request, Response } from 'express';
import { DashboardService } from '../services/dashboard/DashboardService';
import { logger } from '../config/logger';

const router = Router();

/**
 * GET /api/dashboard/metrics
 * Get all dashboard metrics
 */
router.get('/metrics', async (_req: Request, res: Response): Promise<void> => {
  try {
    const metrics = await DashboardService.getDashboardMetrics();
    res.json(metrics);
  } catch (error: any) {
    logger.error('Error fetching dashboard metrics:', error);
    res.status(500).json({
      error: 'Failed to fetch dashboard metrics',
      message: error.message,
    });
  }
});

export default router;
