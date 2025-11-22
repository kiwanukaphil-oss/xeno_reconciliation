const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function verifyTotals() {
  try {
    console.log('=== Verifying December 2017 Totals ===\n');

    // Check fund_transactions table directly
    const decFundTxs = await prisma.fundTransaction.findMany({
      where: {
        transactionDate: {
          gte: new Date('2017-12-01'),
          lte: new Date('2017-12-31'),
        },
      },
      include: {
        fund: true,
        client: true,
      },
    });

    console.log('Fund Transactions in December 2017:', decFundTxs.length);

    // Group by goalTransactionCode
    const byCode = {};
    decFundTxs.forEach(ft => {
      if (!byCode[ft.goalTransactionCode]) {
        byCode[ft.goalTransactionCode] = {
          code: ft.goalTransactionCode,
          fundTxs: [],
          total: 0,
        };
      }
      byCode[ft.goalTransactionCode].fundTxs.push(ft);
      byCode[ft.goalTransactionCode].total += parseFloat(ft.amount);
    });

    const goalTxCodes = Object.keys(byCode);
    console.log('Unique goal transaction codes:', goalTxCodes.length);

    const totalAmount = Object.values(byCode).reduce((sum, g) => sum + g.total, 0);
    console.log('Total amount (sum of fund txs): UGX', totalAmount.toLocaleString());

    console.log('\nFirst 5 goal transactions:');
    goalTxCodes.slice(0, 5).forEach(code => {
      const g = byCode[code];
      console.log(`  ${code}: ${g.fundTxs.length} fund txs, UGX ${g.total.toLocaleString()}`);
    });

    // Check for duplicates within same goalTransactionCode
    console.log('\n=== Checking for duplicate fund codes within goal transactions ===');
    let duplicatesFound = 0;
    goalTxCodes.forEach(code => {
      const fundCodes = byCode[code].fundTxs.map(ft => ft.fund.fundCode);
      const uniqueFunds = new Set(fundCodes);
      if (fundCodes.length !== uniqueFunds.size) {
        duplicatesFound++;
        console.log(`  ${code}: ${fundCodes.length} fund txs, but only ${uniqueFunds.size} unique funds`);
        console.log(`    Funds: ${fundCodes.join(', ')}`);
      }
    });

    if (duplicatesFound === 0) {
      console.log('  ✅ No duplicate fund codes found within goal transactions');
    } else {
      console.log(`  ⚠️  Found ${duplicatesFound} goal transactions with duplicate fund codes`);
    }

    // Now check from 2018-01-01 onwards
    console.log('\n=== Checking from 2018-01-01 onwards ===');
    const from2018 = await prisma.fundTransaction.aggregate({
      where: {
        transactionDate: {
          gte: new Date('2018-01-01'),
        },
      },
      _sum: {
        amount: true,
      },
      _count: true,
    });

    console.log('Fund transactions from 2018-01-01:', from2018._count);
    console.log('Total amount: UGX', parseFloat(from2018._sum.amount || 0).toLocaleString());

    console.log('\n=== Expected Totals ===');
    console.log('Upload file (2018-2019): UGX 6,195,659,337');
    console.log('Database from 2018-01-01: UGX', parseFloat(from2018._sum.amount || 0).toLocaleString());
    console.log('Database Dec 2017: UGX', totalAmount.toLocaleString());
    console.log('Database Dec 2017 + 2018 onwards: UGX', (totalAmount + parseFloat(from2018._sum.amount || 0)).toLocaleString());
    console.log('\nVariance: UGX', (6195659337 - parseFloat(from2018._sum.amount || 0)).toLocaleString());

  } catch (error) {
    console.error('Error:', error);
  } finally {
    await prisma.$disconnect();
  }
}

verifyTotals();
