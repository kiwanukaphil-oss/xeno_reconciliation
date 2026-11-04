import ExcelJS from 'exceljs';
import { buildMonthColumn, excelFormulaFor, UG_ROWS, UgRowFormat } from './UgMetricsLayout';
import { UG_METRIC_DEFINITIONS, UgMonthlyMetrics } from './UgMonthlyMetricsService';
import { UgManualInputsForMonth } from './UgManualInputService';

const NUMBER_FORMATS: Record<UgRowFormat, string> = {
  int: '#,##0',
  ugx: '#,##0',
  pct: '0.0%',
  avg: '#,##0',
  rate: '#,##0.00',
};

const FIRST_MONTH_COLUMN = 3; // C, as in the original workbook
const MANUAL_FILL: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF7D6' } };
const HEADER_FONT: Partial<ExcelJS.Font> = { bold: true };

/**
 * Writes the Inputs-UG workbook: one "Inputs-UG" sheet laid out row-for-row like the monthly report
 * (months across from column C, derived rows as live formulas, manual rows shaded and holding any
 * hand-entered figures, a Source column after the months), plus an "About" sheet with definitions
 * and price dates.
 */
export async function writeUgMetricsWorkbook(
  months: UgMonthlyMetrics[],
  manual: Map<string, UgManualInputsForMonth> = new Map()
): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.created = new Date();
  const sheet = workbook.addWorksheet('Inputs-UG', { views: [{ state: 'frozen', xSplit: 2, ySplit: 2 }] });
  const columns = months.map((m) => buildMonthColumn(m, manual.get(m.month)?.values));
  const sourceColumn = FIRST_MONTH_COLUMN + months.length;

  sheet.getColumn(1).width = 6;
  sheet.getColumn(2).width = 40;
  columns.forEach((_, i) => (sheet.getColumn(FIRST_MONTH_COLUMN + i).width = 17));
  sheet.getColumn(sourceColumn).width = 48;

  sheet.getCell('B1').value = 'XENO Metrics - Inputs UG (computed by the reconciliation system)';
  sheet.getCell('B1').font = { bold: true, size: 12 };
  sheet.getCell('B2').value = 'Metric';
  sheet.getCell(2, sourceColumn).value = 'Source';
  sheet.getRow(2).font = HEADER_FONT;
  columns.forEach((column, i) => {
    const cell = sheet.getCell(2, FIRST_MONTH_COLUMN + i);
    cell.value = new Date(`${column.periodEnd}T00:00:00Z`);
    cell.numFmt = 'mmm-yy';
  });

  for (const def of UG_ROWS) {
    const row = sheet.getRow(def.row);
    if (def.band) row.getCell(1).value = def.band;
    row.getCell(2).value = def.label;
    if (def.kind === 'header') {
      row.getCell(2).font = HEADER_FONT;
      continue;
    }
    columns.forEach((column, i) => {
      const cell = row.getCell(FIRST_MONTH_COLUMN + i);
      const value = column.values[def.row];
      if (def.kind === 'formula') {
        const columnLetter = sheet.getColumn(FIRST_MONTH_COLUMN + i).letter;
        cell.value = { formula: excelFormulaFor(def, columnLetter)!, result: value ?? '' } as ExcelJS.CellFormulaValue;
      } else if (def.kind === 'manual') {
        // Shaded either way, so hand-entered figures stay distinguishable from system ones
        cell.value = value;
        cell.fill = MANUAL_FILL;
      } else {
        cell.value = value;
      }
      if (def.format) cell.numFmt = NUMBER_FORMATS[def.format];
    });
    const source = row.getCell(sourceColumn);
    source.value = def.kind === 'manual' ? `Manual input: ${def.source}` : def.kind === 'formula' ? 'Formula' : 'System';
    source.font = { color: { argb: 'FF6B7280' } };
  }

  writeAboutSheet(workbook.addWorksheet('About'), months);
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

function writeAboutSheet(sheet: ExcelJS.Worksheet, months: UgMonthlyMetrics[]): void {
  sheet.getColumn(1).width = 34;
  sheet.getColumn(2).width = 120;
  sheet.addRow(['XENO Metrics - Inputs UG']).font = { bold: true, size: 14 };
  sheet.addRow(['Generated', new Date().toISOString().slice(0, 10)]);
  sheet.addRow(['Months', `${months[0].month} to ${months[months.length - 1].month}`]);
  sheet.addRow([]);
  sheet.addRow(['Definitions']).font = HEADER_FONT;
  UG_METRIC_DEFINITIONS.forEach((line) => (sheet.addRow(['', line]).getCell(2).alignment = { wrapText: true }));
  sheet.addRow([]);
  sheet.addRow(['Not computed by the system (shaded rows)']).font = HEADER_FONT;
  months[0].notComputed.forEach((n) => sheet.addRow([n.metric, n.reason]));
  sheet.addRow([]);
  sheet.addRow(['Month-end balances valued at prices of']).font = HEADER_FONT;
  months.forEach((m) => sheet.addRow([m.month, m.priceAsOf ?? 'n/a']));
}
