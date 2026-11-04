// Prepares Ultima fund transaction exports (written for the 2026 catch-up) for upload, mirroring Ultima row-for-row
// and only normalising what validation requires (rules agreed with the user on 2026-11-03):
//   1. Reversals: transactionId NA/0/blank/NAN with source NA/N/A/NAN/blank
//      -> source "Transfer_Reversal", transactionId "{transactionDate}-Transfer_Reversal"
//   2. George Ouma rows with source "WEB" -> source "Transfer_Reversal" (original transactionId kept)
//   3. Payout rows with a missing/"0" source get the client's usual withdrawal channel; where the batch ID
//      sits in the source column it is moved to transactionId. Anyango Macella / Dastan Ndyaguma have the
//      same withdrawal twice in Ultima: the shifted copy gets a "-DUP" suffix so it stays a separate goal transaction.
//   4. Rows dated after the cut-off (future-dated) and rows already in the DB are left out and listed.
//   5. Zero-amount legs posted later under a different account-holder name take the client name of the
//      money-carrying legs in the same goal transaction (validation requires one client per goal transaction).
//   6. Blank client names take the name Ultima uses for that account everywhere else.
// Date cells keep a yyyy-mm-dd format because ExcelParser reads formatted text.
// Usage: node scripts/prepare-ultima-fund-exports.js <srcDir> <outDir> <maxTransactionDate>
const XLSX = require('xlsx');
const fs = require('fs');
const path = require('path');
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const VALID_SOURCES = ['Transfer_Reversal', 'AIRTEL_APP', 'MTN_USSD', 'AIRTEL_WEB', 'MTN_APP', 'MTN_WEB', 'BANK', 'MTN_MOMO', 'AIRTEL_MONEY', 'RT_Adjustment'];
const PLACEHOLDER_IDS = ['', 'NA', '0', 'NAN'];
const PLACEHOLDER_SOURCES = ['', 'NA', 'N/A', 'NAN'];
const PAYOUT_CHANNEL_BY_CLIENT = { 'Kefa Martin': 'BANK', 'ANYANGO MACELLA': 'MTN_MOMO', 'Dastan Ndyaguma': 'MTN_MOMO' };
const DUPLICATE_COPY_CLIENTS = ['ANYANGO MACELLA', 'Dastan Ndyaguma'];
// Expected counts from the review, so an unexpected pattern stops the run instead of slipping through
const EXPECTED = { reversal: 5776, georgeOuma: 16, payoutSourceZero: 8, payoutShifted: 11 };
// Zero-amount legs on 20 May 2026 whose holder name differs from the rest of their goal transaction
const CLIENT_NAME_BY_FUND_TXN_PREFIX = {
  bb56b665: 'Sudais Dax', e4475618: 'Sudais Dax', // account 701-251091712, Ultima shows "Katumba "
  '9ab175c9': 'KAWEESA ERIYA', '223efb8a': 'KAWEESA ERIYA', // account 701-440736782, Ultima shows "NAMUGAMBE JULIET"
};
// Accounts whose rows sometimes come through with a blank client name (name as Ultima spells it elsewhere)
const CLIENT_NAME_FOR_BLANK_BY_ACCOUNT = { '701-646727355': 'KATAMBA ' };

const normalise = (v) => (v === undefined || v === null ? '' : String(v).trim().toUpperCase());

/** Decide how one row should be rewritten; returns { rule, transactionId, source } or null for no change. */
function classifyRowFix(row, transactionDate) {
  const id = normalise(row.transactionId);
  const src = normalise(row.source);
  if (PLACEHOLDER_IDS.includes(id) && PLACEHOLDER_SOURCES.includes(src)) {
    return { rule: 'reversal', transactionId: `${transactionDate}-Transfer_Reversal`, source: 'Transfer_Reversal' };
  }
  if (src === 'WEB' && row.clientName === 'George Ouma') {
    return { rule: 'georgeOuma', transactionId: row.transactionId, source: 'Transfer_Reversal' };
  }
  if (src === '0' && PAYOUT_CHANNEL_BY_CLIENT[row.clientName]) {
    return { rule: 'payoutSourceZero', transactionId: row.transactionId, source: PAYOUT_CHANNEL_BY_CLIENT[row.clientName] };
  }
  if (id === '' && String(row.source).includes('/') && PAYOUT_CHANNEL_BY_CLIENT[row.clientName]) {
    const suffix = DUPLICATE_COPY_CLIENTS.includes(row.clientName) ? '-DUP' : '';
    return { rule: 'payoutShifted', transactionId: `${row.source}${suffix}`, source: PAYOUT_CHANNEL_BY_CLIENT[row.clientName] };
  }
  return null;
}

/** Rewrite one export into outPath, applying fixes cell-by-cell; returns per-rule counts and dropped rows. */
async function prepareExportFile(srcPath, outPath, maxDate) {
  const wb = XLSX.readFile(srcPath);
  const ws = wb.Sheets[wb.SheetNames[0]];
  if (!ws['!ref']) return { rows: 0, kept: 0, counts: {}, dropped: [], invalid: [] };
  const range = XLSX.utils.decode_range(ws['!ref']);
  const header = [];
  for (let c = 0; c <= range.e.c; c++) header.push(ws[XLSX.utils.encode_cell({ r: 0, c })].v);
  const col = (name) => header.indexOf(name);
  const dateCols = new Set([col('transactionDate'), col('dateCreated')]);
  const rows = XLSX.utils.sheet_to_json(ws, { raw: true, defval: null });

  const existing = new Set();
  const ids = rows.map((r) => r.fundTransactionId);
  for (let i = 0; i < ids.length; i += 5000) {
    (await prisma.fundTransaction.findMany({ where: { fundTransactionId: { in: ids.slice(i, i + 5000) } }, select: { fundTransactionId: true } }))
      .forEach((f) => existing.add(f.fundTransactionId));
  }

  const outWs = {};
  const counts = {};
  const dropped = [];
  const invalid = [];
  let outRow = 0;
  const copyRow = (r, overrides) => {
    for (let c = 0; c <= range.e.c; c++) {
      const target = XLSX.utils.encode_cell({ r: outRow, c });
      if (overrides && overrides[header[c]] !== undefined) {
        outWs[target] = { t: 's', v: String(overrides[header[c]]) };
        continue;
      }
      const cell = ws[XLSX.utils.encode_cell({ r, c })];
      if (!cell) continue;
      outWs[target] = r > 0 && cell.t === 'n' && dateCols.has(c) ? { ...cell, z: 'yyyy-mm-dd' } : { ...cell };
    }
    outRow++;
  };

  copyRow(0);
  rows.forEach((row, i) => {
    const transactionDate = XLSX.SSF.format('yyyy-mm-dd', row.transactionDate);
    if (existing.has(row.fundTransactionId)) return dropped.push(`${row.fundTransactionId} already in DB`);
    if (transactionDate > maxDate) return dropped.push(`${row.fundTransactionId} ${transactionDate} ${row.clientName} future-dated`);
    const fix = classifyRowFix(row, transactionDate);
    if (fix) counts[fix.rule] = (counts[fix.rule] || 0) + 1;
    const finalSource = fix ? fix.source : row.source;
    if (!VALID_SOURCES.includes(finalSource) || normalise(fix ? fix.transactionId : row.transactionId) === '') {
      invalid.push(`${row.fundTransactionId} id=${row.transactionId} src=${row.source}`);
    }
    const overrides = fix ? { transactionId: fix.transactionId, source: fix.source } : {};
    const nameFix = CLIENT_NAME_BY_FUND_TXN_PREFIX[String(row.fundTransactionId).slice(0, 8)];
    if (nameFix && Number(row.amount) === 0) {
      overrides.clientName = nameFix;
      counts.clientNameAligned = (counts.clientNameAligned || 0) + 1;
    }
    const blankNameFix = CLIENT_NAME_FOR_BLANK_BY_ACCOUNT[row.accountNumber];
    if (blankNameFix && normalise(row.clientName) === '') {
      overrides.clientName = blankNameFix;
      counts.blankNameFilled = (counts.blankNameFilled || 0) + 1;
    }
    copyRow(i + 1, Object.keys(overrides).length ? overrides : null);
  });

  outWs['!ref'] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: outRow - 1, c: range.e.c } });
  const outWb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(outWb, outWs, wb.SheetNames[0]);
  if (outRow > 1) XLSX.writeFile(outWb, outPath);
  return { rows: rows.length, kept: outRow - 1, counts, dropped, invalid };
}

(async () => {
  const [srcDir, outDir, maxDate, onlyFile] = process.argv.slice(2);
  fs.mkdirSync(outDir, { recursive: true });
  const totals = {};
  let invalidTotal = 0;
  const files = fs.readdirSync(srcDir).filter((f) => f.endsWith('.xlsx') && !f.startsWith('~$') && (!onlyFile || f === onlyFile)).sort();
  for (const f of files) {
    const result = await prepareExportFile(path.join(srcDir, f), path.join(outDir, f), maxDate);
    Object.entries(result.counts).forEach(([k, v]) => (totals[k] = (totals[k] || 0) + v));
    invalidTotal += result.invalid.length;
    console.log(`${f}: ${result.kept}/${result.rows} kept ${JSON.stringify(result.counts)}`);
    result.dropped.forEach((d) => console.log('   dropped', d));
    result.invalid.slice(0, 5).forEach((d) => console.log('   STILL INVALID', d));
  }
  console.log('Totals:', totals, 'still invalid:', invalidTotal);
  const mismatched = Object.entries(EXPECTED).filter(([k, v]) => (totals[k] || 0) !== v);
  console.log(mismatched.length || invalidTotal ? `CHECK FAILED: ${JSON.stringify(mismatched)}` : 'All counts match the review.');
  await prisma.$disconnect();
})();
