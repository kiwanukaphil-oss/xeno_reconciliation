import ExcelJS from 'exceljs';
import { ImpactPack, PackColumnFormat, PackQuestion, PackTable } from './ImpactPackService';

const NUMBER_FORMATS: Record<PackColumnFormat, string | undefined> = {
  text: undefined,
  int: '#,##0',
  ugx: '#,##0',
  pct: '0.0%',
};

// Same readable labels as the web page (frontend insightFormat.formatGroupLabel)
const LABEL_OVERRIDES: Record<string, string> = {
  UNKNOWN: 'Unknown',
  MTN: 'MTN',
  WEB: 'Web',
  APP: 'App',
  YOLLO: 'Yollo',
  AIRTEL: 'Airtel',
  OTHER_UG: 'Other Ugandan network',
  FOREIGN: 'Foreign number',
  ABROAD: 'Abroad',
};

/** "CENTRAL" -> "Central", "3. 500k - 5m" -> "500k - 5m"; prose and amounts are left unchanged. */
function formatCodeLabel(value: string): string {
  if (LABEL_OVERRIDES[value]) return LABEL_OVERRIDES[value];
  const withoutOrderPrefix = value.replace(/^\d+\.\s/, '');
  if (!/^[A-Z][A-Z0-9_]*$/.test(withoutOrderPrefix)) return withoutOrderPrefix;
  const words = withoutOrderPrefix.toLowerCase().replace(/_/g, ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}

const SHEET_NAMES: Record<PackQuestion, string> = {
  Q1: '1. Customer profile',
  Q2: '2. Usage & access',
  Q3: '3. Outcomes',
};

/**
 * Writes the impact pack as an Excel workbook: a "Read me" sheet with as-of dates,
 * definitions, caveats and items not captured, then one sheet per question with
 * its tables stacked (title, note, header, rows).
 */
export async function writeImpactPackWorkbook(pack: ImpactPack): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.created = new Date(pack.generatedAt);
  writeReadMeSheet(workbook.addWorksheet('Read me'), pack);

  for (const question of ['Q1', 'Q2', 'Q3'] as PackQuestion[]) {
    const sheet = workbook.addWorksheet(SHEET_NAMES[question]);
    sheet.getColumn(1).width = 44;
    for (let c = 2; c <= 10; c++) sheet.getColumn(c).width = 18;
    const titleRow = sheet.addRow([pack.questions[question]]);
    titleRow.font = { bold: true, size: 13 };
    sheet.addRow([]);
    for (const table of pack.tables.filter((t) => t.question === question)) {
      writeTable(sheet, table);
    }
  }

  return Buffer.from(await workbook.xlsx.writeBuffer());
}

function writeReadMeSheet(sheet: ExcelJS.Worksheet, pack: ImpactPack): void {
  sheet.getColumn(1).width = 40;
  sheet.getColumn(2).width = 110;
  sheet.addRow(['XENO Impact & Inclusion data pack']).font = { bold: true, size: 14 };
  sheet.addRow(['Generated', pack.generatedAt.slice(0, 10)]);
  sheet.addRow(['As at', pack.asOf.snapshot ?? 'Latest (all data in the system)']).font = { bold: true };
  sheet.addRow(['Transactions complete to', pack.asOf.transactions]);
  sheet.addRow(['Balances valued at prices of', pack.asOf.prices]);
  sheet.addRow(['Ultima goal statistics as of', pack.asOf.ultimaGoalSnapshot ?? 'n/a']);
  sheet.addRow([]);
  sheet.addRow(['Definitions and caveats']).font = { bold: true };
  pack.readMe.forEach((line) => (sheet.addRow(['', line]).getCell(2).alignment = { wrapText: true }));
  sheet.addRow([]);
  sheet.addRow(['Not captured in the system']).font = { bold: true };
  pack.notCaptured.forEach((n) => (sheet.addRow([n.item, n.note]).getCell(2).alignment = { wrapText: true }));
}

function writeTable(sheet: ExcelJS.Worksheet, table: PackTable): void {
  sheet.addRow([table.title]).font = { bold: true, size: 12 };
  if (table.note) {
    const noteRow = sheet.addRow([table.note]);
    noteRow.font = { italic: true, color: { argb: 'FF6B7280' } };
  }
  const header = sheet.addRow(table.columns.map((c) => c.header));
  header.font = { bold: true };
  header.eachCell((cell) => {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE5E7EB' } };
  });

  for (const row of table.rows) {
    const excelRow = sheet.addRow(
      table.columns.map((c) => {
        const value = row[c.key] ?? null;
        return c.format === 'text' && typeof value === 'string' ? formatCodeLabel(value) : value;
      })
    );
    table.columns.forEach((column, i) => {
      const format = NUMBER_FORMATS[column.format];
      if (format) excelRow.getCell(i + 1).numFmt = format;
    });
  }
  sheet.addRow([]);
}
