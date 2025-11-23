import { Router, Request, Response } from 'express';
import { UnitRegistryService } from '../services/unit-registry/UnitRegistryService';
import { MaterializedViewService } from '../services/unit-registry/MaterializedViewService';
import { logger } from '../config/logger';

const router = Router();

/**
 * GET /api/unit-registry
 * Get unit registry with current client positions
 */
router.get('/', async (req: Request, res: Response) => {
  try {
    const includeZeroBalances = req.query.includeZeroBalances === 'true';
    const search = req.query.search as string | undefined;
    const limit = req.query.limit ? parseInt(req.query.limit as string) : 100;
    const offset = req.query.offset ? parseInt(req.query.offset as string) : 0;
    const sortBy = (req.query.sortBy as string) || 'clientName';
    const sortOrder = (req.query.sortOrder as 'asc' | 'desc') || 'asc';

    const result = await UnitRegistryService.getUnitRegistry({
      includeZeroBalances,
      search,
      limit,
      offset,
      sortBy,
      sortOrder,
    });

    return res.json(result);
  } catch (error: any) {
    logger.error('Error fetching unit registry:', error);
    return res.status(500).json({
      error: 'Failed to fetch unit registry',
      message: error.message,
    });
  }
});

/**
 * POST /api/unit-registry/refresh
 * Manually refresh the materialized view
 */
router.post('/refresh', async (_req: Request, res: Response) => {
  try {
    logger.info('Manual materialized view refresh requested');
    const result = await MaterializedViewService.refreshAccountBalances();

    return res.json({
      success: result.success,
      message: result.success
        ? `Materialized view refreshed successfully in ${result.duration}ms`
        : 'Failed to refresh materialized view',
      duration: result.duration,
      error: result.error,
    });
  } catch (error: any) {
    logger.error('Error refreshing materialized view:', error);
    return res.status(500).json({
      error: 'Failed to refresh materialized view',
      message: error.message,
    });
  }
});

/**
 * GET /api/unit-registry/stats
 * Get materialized view statistics
 */
router.get('/stats', async (_req: Request, res: Response) => {
  try {
    const stats = await MaterializedViewService.getViewStats();

    return res.json({
      ...stats,
      needsRefresh: await MaterializedViewService.needsRefresh(),
    });
  } catch (error: any) {
    logger.error('Error fetching view stats:', error);
    return res.status(500).json({
      error: 'Failed to fetch view stats',
      message: error.message,
    });
  }
});

export default router;
