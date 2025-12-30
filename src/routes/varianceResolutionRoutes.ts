import express from 'express';
import { VarianceResolutionService } from '../services/reconciliation/VarianceResolutionService';
import { logger } from '../config/logger';
import ExcelJS from 'exceljs';

const router = express.Router();

/**
 * POST /api/variance-resolution/detect
 * Manually trigger variance resolution detection
 */
router.post('/detect', async (req, res) => {
  try {
    const { startDate, endDate, triggeredBy = 'manual' } = req.body;

    logger.info('Manual variance resolution detection triggered', {
      startDate,
      endDate,
      triggeredBy,
    });

    const dateRange = startDate && endDate ? { startDate, endDate } : undefined;
    const result = await VarianceResolutionService.detectResolvedVariances(
      undefined, // No batch ID for manual trigger
      dateRange
    );

    res.json({
      success: true,
      message: `Detected ${result.resolved} resolved variances`,
      data: result,
    });
  } catch (error: any) {
    logger.error('Manual variance resolution detection failed:', error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * GET /api/variance-resolution/report
 * Get resolved variances report
 */
router.get('/report', async (req, res) => {
  try {
    const {
      startDate,
      endDate,
      goalNumber,
      clientSearch,
      originalTag,
    } = req.query;

    const dateRange = startDate && endDate
      ? { startDate: String(startDate), endDate: String(endDate) }
      : undefined;

    const filters = {
      goalNumber: goalNumber ? String(goalNumber) : undefined,
      clientSearch: clientSearch ? String(clientSearch) : undefined,
      originalTag: originalTag ? String(originalTag) : undefined,
    };

    const result = await VarianceResolutionService.getResolvedVariancesReport(
      dateRange,
      filters
    );

    res.json({
      success: true,
      data: result.data,
      summary: result.summary,
    });
  } catch (error: any) {
    logger.error('Failed to get resolved variances report:', error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * GET /api/variance-resolution/stats
 * Get resolution statistics
 */
router.get('/stats', async (_req, res) => {
  try {
    const stats = await VarianceResolutionService.getResolutionStats();

    res.json({
      success: true,
      data: stats,
    });
  } catch (error: any) {
    logger.error('Failed to get resolution stats:', error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * GET /api/variance-resolution/export
 * Export resolved variances to Excel
 */
router.get('/export', async (req, res) => {
  try {
    const {
      startDate,
      endDate,
      goalNumber,
      clientSearch,
      originalTag,
    } = req.query;

    const dateRange = startDate && endDate
      ? { startDate: String(startDate), endDate: String(endDate) }
      : undefined;

    const filters = {
      goalNumber: goalNumber ? String(goalNumber) : undefined,
      clientSearch: clientSearch ? String(clientSearch) : undefined,
      originalTag: originalTag ? String(originalTag) : undefined,
    };

    const result = await VarianceResolutionService.getResolvedVariancesReport(
      dateRange,
      filters
    );

    // Create Excel workbook
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'XENO Reconciliation System';
    workbook.created = new Date();

    // Add summary sheet
    const summarySheet = workbook.addWorksheet('Summary');
    summarySheet.columns = [
      { header: 'Metric', key: 'metric', width: 30 },
      { header: 'Value', key: 'value', width: 20 },
    ];

    summarySheet.addRow({ metric: 'Total Resolved Variances', value: result.summary.totalResolved });
    summarySheet.addRow({ metric: 'Bank Transactions', value: result.summary.bySource.bank });
    summarySheet.addRow({ metric: 'Goal Transactions', value: result.summary.bySource.goal });
    summarySheet.addRow({ metric: '', value: '' });
    summarySheet.addRow({ metric: 'By Original Tag:', value: '' });

    for (const [tag, count] of Object.entries(result.summary.byTag)) {
      summarySheet.addRow({ metric: `  ${tag}`, value: count });
    }

    // Style summary header
    summarySheet.getRow(1).font = { bold: true };
    summarySheet.getRow(1).fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF4CAF50' },
    };

    // Add data sheet
    const dataSheet = workbook.addWorksheet('Resolved Variances');
    dataSheet.columns = [
      { header: 'Source', key: 'source', width: 10 },
      { header: 'Goal Number', key: 'goalNumber', width: 25 },
      { header: 'Client Name', key: 'clientName', width: 30 },
      { header: 'Account Number', key: 'accountNumber', width: 20 },
      { header: 'Transaction Date', key: 'transactionDate', width: 15 },
      { header: 'Type', key: 'transactionType', width: 12 },
      { header: 'Amount', key: 'amount', width: 18 },
      { header: 'Transaction ID', key: 'sourceTransactionId', width: 20 },
      { header: 'Original Tag', key: 'originalTag', width: 20 },
      { header: 'Resolved At', key: 'resolvedAt', width: 20 },
      { header: 'Resolution Reason', key: 'resolvedReason', width: 50 },
    ];

    // Add data rows
    for (const row of result.data) {
      dataSheet.addRow({
        source: row.source,
        goalNumber: row.goalNumber,
        clientName: row.clientName,
        accountNumber: row.accountNumber,
        transactionDate: row.transactionDate ? new Date(row.transactionDate).toISOString().split('T')[0] : '',
        transactionType: row.transactionType,
        amount: row.amount,
        sourceTransactionId: row.sourceTransactionId,
        originalTag: row.originalTag,
        resolvedAt: row.resolvedAt ? new Date(row.resolvedAt).toISOString() : '',
        resolvedReason: row.resolvedReason,
      });
    }

    // Style data header
    dataSheet.getRow(1).font = { bold: true };
    dataSheet.getRow(1).fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF2196F3' },
    };

    // Format amount column
    dataSheet.getColumn('amount').numFmt = '#,##0.00';

    // Set response headers
    const filename = `resolved_variances_${new Date().toISOString().split('T')[0]}.xlsx`;
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

    // Write to response
    await workbook.xlsx.write(res);
    res.end();
  } catch (error: any) {
    logger.error('Failed to export resolved variances:', error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

export default router;
