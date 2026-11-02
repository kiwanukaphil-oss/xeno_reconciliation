import XLSX from 'xlsx';

export type UltimaSheetKind = 'CLIENT_ACCOUNTS' | 'GOAL_DATA' | 'GOAL_STATS' | 'BANK_ACCOUNTS' | 'UNKNOWN';
export type UltimaRow = Record<string, unknown>;

/**
 * Yields rows from an Ultima "Client Data Export" or "Goal Stats Data Export"
 * workbook, one file at a time.
 *
 * Uses SheetJS rather than a streaming reader because Ultima writes its xlsx zip
 * in a form forward-only unzippers reject. The Bank Accounts sheet is never
 * loaded. Dates are left as Excel serial numbers (parsed later as UTC) because
 * SheetJS's own date conversion applies the machine's timezone and can shift a
 * date of birth by a day.
 *
 * Sheets are identified by their header row rather than by name, so renamed tabs
 * still work.
 */
export async function* readUltimaExportRows(
  filePath: string
): AsyncGenerator<{ sheet: UltimaSheetKind; row: UltimaRow }> {
  const workbook = readWorkbookQuietly(filePath);
  const sheetsToLoad = workbook.SheetNames.filter((name) => !/bank/i.test(name));

  for (const name of sheetsToLoad) {
    const rows = XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets[name], { header: 1, raw: true, defval: null, blankrows: false });
    const headerIndex = rows.findIndex((r) => r.some((v) => v !== null && v !== ''));
    if (headerIndex < 0) continue;

    const headers = rows[headerIndex].map((v) => String(v ?? '').trim());
    const sheet = identifySheetKind(headers);
    if (sheet === 'BANK_ACCOUNTS' || sheet === 'UNKNOWN') continue;

    for (let i = headerIndex + 1; i < rows.length; i++) {
      const record: UltimaRow = {};
      headers.forEach((header, col) => {
        if (header) record[header] = rows[i][col] ?? null;
      });
      yield { sheet, row: record };
    }
  }
}

/**
 * Ultima's zip entries declare an uncompressed size of 0, which SheetJS reports
 * once per entry via console.error ("Bad uncompressed size") while still reading
 * the data correctly. Only that exact message is suppressed.
 */
function readWorkbookQuietly(filePath: string): XLSX.WorkBook {
  const originalConsoleError = console.error;
  console.error = (...args: unknown[]) => {
    if (typeof args[0] === 'string' && args[0].startsWith('Bad uncompressed size')) return;
    originalConsoleError(...args);
  };
  try {
    return XLSX.readFile(filePath, { dense: true, cellDates: false });
  } finally {
    console.error = originalConsoleError;
  }
}

function identifySheetKind(headers: string[]): UltimaSheetKind {
  if (headers.includes('Account Number') && headers.includes('Gender')) return 'CLIENT_ACCOUNTS';
  if (headers.includes('goalNumber') && headers.includes('riskTolerance')) return 'GOAL_DATA';
  if (headers.includes('goalNumber') && headers.includes('goalTarget') && headers.includes('currentValue')) return 'GOAL_STATS';
  if (headers.includes('bankName')) return 'BANK_ACCOUNTS';
  return 'UNKNOWN';
}
