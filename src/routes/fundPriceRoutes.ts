import { Router, Request, Response } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { FundPriceService } from '../services/fund-price/FundPriceService';
import { FundPriceParser } from '../services/fund-price/FundPriceParser';
import { logger } from '../config/logger';

const router = Router();

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    const uploadDir = path.join(process.cwd(), 'uploads', 'temp');
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: (_req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, `fund-prices-${uniqueSuffix}${path.extname(file.originalname)}`);
  },
});

const upload = multer({
  storage,
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB max
  },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (ext === '.csv' || ext === '.xlsx' || ext === '.xls') {
      cb(null, true);
    } else {
      cb(new Error('Only CSV and Excel files are allowed'));
    }
  },
});

/**
 * POST /api/fund-prices/upload
 * Upload fund prices from CSV/Excel file
 */
router.post('/upload', upload.single('file'), async (req: Request, res: Response) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    logger.info(`Processing fund prices upload: ${req.file.originalname}`);

    // Parse file
    const prices = await FundPriceParser.parseFile(req.file.path);

    logger.info(`Parsed ${prices.length} fund price records`);

    // Upload prices
    const result = await FundPriceService.uploadPrices(prices);

    // Clean up file
    fs.unlinkSync(req.file.path);

    logger.info(`Fund prices upload complete: ${result.inserted} inserted, ${result.updated} updated, ${result.failed} failed`);

    return res.json({
      success: result.success,
      message: result.success
        ? 'Fund prices uploaded successfully'
        : 'Fund prices uploaded with some errors',
      summary: {
        totalRecords: result.totalRecords,
        inserted: result.inserted,
        updated: result.updated,
        failed: result.failed,
      },
      errors: result.errors,
    });
  } catch (error: any) {
    logger.error('Fund price upload error:', error);

    // Clean up file if it exists
    if (req.file && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }

    return res.status(500).json({
      error: 'Failed to upload fund prices',
      message: error.message,
    });
  }
});

/**
 * GET /api/fund-prices
 * Get fund prices with optional filters
 */
router.get('/', async (req: Request, res: Response) => {
  try {
    const filters = {
      fundCode: req.query.fundCode as string,
      startDate: req.query.startDate ? new Date(req.query.startDate as string) : undefined,
      endDate: req.query.endDate ? new Date(req.query.endDate as string) : undefined,
      limit: req.query.limit ? parseInt(req.query.limit as string) : 100,
      offset: req.query.offset ? parseInt(req.query.offset as string) : 0,
    };

    const result = await FundPriceService.getPrices(filters);

    res.json(result);
  } catch (error: any) {
    logger.error('Error fetching fund prices:', error);
    res.status(500).json({
      error: 'Failed to fetch fund prices',
      message: error.message,
    });
  }
});

/**
 * GET /api/fund-prices/latest
 * Get latest prices for all funds
 */
router.get('/latest', async (_req: Request, res: Response) => {
  try {
    const prices = await FundPriceService.getLatestPrices();

    return res.json({
      prices,
      count: prices.length,
    });
  } catch (error: any) {
    logger.error('Error fetching latest fund prices:', error);
    return res.status(500).json({
      error: 'Failed to fetch latest fund prices',
      message: error.message,
    });
  }
});

/**
 * GET /api/fund-prices/template/download
 * Download fund prices template Excel file
 * IMPORTANT: Must be before /:fundCode/:date route
 */
router.get('/template/download', (_req: Request, res: Response): void => {
  const templatePath = path.join(
    process.cwd(),
    'Reference Docs',
    'fund_prices_template.xlsx'
  );

  if (!fs.existsSync(templatePath)) {
    res.status(404).json({ error: 'Template file not found' });
    return;
  }

  res.download(templatePath, 'fund_prices_template.xlsx', (err) => {
    if (err) {
      logger.error('Error downloading template:', err);
    }
  });
});

/**
 * GET /api/fund-prices/:fundCode/:date
 * Get price for specific fund and date
 */
router.get('/:fundCode/:date', async (req: Request, res: Response) => {
  try {
    const { fundCode, date } = req.params;
    const priceDate = new Date(date);

    if (isNaN(priceDate.getTime())) {
      return res.status(400).json({ error: 'Invalid date format' });
    }

    const price = await FundPriceService.getPriceByFundAndDate(fundCode, priceDate);

    if (!price) {
      return res.status(404).json({ error: 'Price not found for this fund and date' });
    }

    return res.json(price);
  } catch (error: any) {
    logger.error('Error fetching fund price:', error);
    return res.status(500).json({
      error: 'Failed to fetch fund price',
      message: error.message,
    });
  }
});

/**
 * DELETE /api/fund-prices/:id
 * Delete a fund price record
 */
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    await FundPriceService.deletePrice(id);

    return res.json({
      success: true,
      message: 'Fund price deleted successfully',
    });
  } catch (error: any) {
    logger.error('Error deleting fund price:', error);
    return res.status(500).json({
      error: 'Failed to delete fund price',
      message: error.message,
    });
  }
});

export default router;
