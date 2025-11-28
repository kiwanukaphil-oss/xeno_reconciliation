import * as fs from 'fs';
import * as Papa from 'papaparse';

/**
 * Analyzes a CSV file to find transaction ID inconsistencies
 * Run with: npx ts-node scripts/analyze-csv-transaction-ids.ts <file-path>
 */

interface CSVRow {
  transactionDate: string;
  clientName: string;
  accountNumber: string;
  goalNumber: string;
  fundCode: string;
  transactionId: string;
  source: string;
  [key: string]: any;
}

async function analyzeCsvTransactionIds(filePath: string) {
  console.log('🔍 ANALYZING CSV FILE FOR TRANSACTION ID ISSUES\n');
  console.log('='.repeat(80));
  console.log(`\nFile: ${filePath}\n`);

  if (!fs.existsSync(filePath)) {
    console.error(`❌ File not found: ${filePath}`);
    process.exit(1);
  }

  const fileContent = fs.readFileSync(filePath, 'utf-8');

  return new Promise<void>((resolve, reject) => {
    Papa.parse(fileContent, {
      header: true,
      skipEmptyLines: true,
      complete: (results) => {
        const rows = results.data as CSVRow[];
        console.log(`Total rows in CSV: ${rows.length}\n`);

        // Group by goal transaction code
        const byGoalTransaction = new Map<string, CSVRow[]>();

        rows.forEach((row, index) => {
          // Generate goal transaction code
          const date = row.transactionDate?.trim();
          const accountNumber = row.accountNumber?.trim();
          const goalNumber = row.goalNumber?.trim();

          if (date && accountNumber && goalNumber) {
            const goalTxCode = `${date}-${accountNumber}-${goalNumber}`;
            if (!byGoalTransaction.has(goalTxCode)) {
              byGoalTransaction.set(goalTxCode, []);
            }
            byGoalTransaction.get(goalTxCode)!.push({ ...row, __rowNumber: index + 2 } as any);
          }
        });

        console.log(`Total goal transactions: ${byGoalTransaction.size}\n`);

        // Find goal transactions with multiple transaction IDs
        const problemGoalTransactions: Array<{
          goalTxCode: string;
          transactionIds: string[];
          sources: string[];
          rows: number[];
        }> = [];

        for (const [goalTxCode, txns] of byGoalTransaction.entries()) {
          const transactionIds = [...new Set(txns.map((t) => t.transactionId?.trim() || ''))];
          const sources = [...new Set(txns.map((t) => t.source?.trim() || ''))];

          if (transactionIds.length > 1 || sources.length > 1) {
            problemGoalTransactions.push({
              goalTxCode,
              transactionIds,
              sources,
              rows: txns.map((t: any) => t.__rowNumber),
            });
          }
        }

        if (problemGoalTransactions.length === 0) {
          console.log('✅ NO ISSUES FOUND!');
          console.log('All goal transactions have consistent transaction IDs and sources.\n');
          resolve();
          return;
        }

        console.log(`❌ FOUND ${problemGoalTransactions.length} GOAL TRANSACTIONS WITH ISSUES:\n`);
        console.log('='.repeat(80));

        problemGoalTransactions.forEach((problem, index) => {
          console.log(`\n${index + 1}. Goal Transaction: ${problem.goalTxCode}`);
          console.log(`   CSV Rows: ${problem.rows.join(', ')}`);

          if (problem.transactionIds.length > 1) {
            console.log(`   ❌ Multiple Transaction IDs (${problem.transactionIds.length}):`);
            problem.transactionIds.forEach((id, idx) => {
              console.log(`      ${idx + 1}. "${id}" (length: ${id.length})`);
              console.log(`         Hex: ${Buffer.from(id).toString('hex')}`);
            });
          }

          if (problem.sources.length > 1) {
            console.log(`   ❌ Multiple Sources (${problem.sources.length}):`);
            problem.sources.forEach((src, idx) => {
              console.log(`      ${idx + 1}. "${src}"`);
            });
          }

          // Show detailed breakdown of this goal transaction
          const txns = byGoalTransaction.get(problem.goalTxCode)!;
          console.log('\n   Detailed Breakdown:');
          console.table(
            txns.map((t: any) => ({
              Row: t.__rowNumber,
              Fund: t.fundCode,
              TransactionId: t.transactionId,
              'ID Length': t.transactionId?.length || 0,
              Source: t.source,
            }))
          );
        });

        console.log('\n' + '='.repeat(80));
        console.log('\n💡 TO FIX:');
        console.log('   1. Open the CSV file');
        console.log('   2. For each goal transaction listed above, ensure ALL fund transactions');
        console.log('      have the EXACT SAME transactionId and source values');
        console.log('   3. Check for invisible characters (spaces, tabs) at the beginning or end');
        console.log('   4. Re-upload the corrected file\n');

        resolve();
      },
      error: (error) => {
        console.error('❌ Error parsing CSV:', error);
        reject(error);
      },
    });
  });
}

// Get file path from command line argument
const filePath = process.argv[2];

if (!filePath) {
  console.error('Usage: npx ts-node scripts/analyze-csv-transaction-ids.ts <path-to-csv-file>');
  process.exit(1);
}

analyzeCsvTransactionIds(filePath)
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
