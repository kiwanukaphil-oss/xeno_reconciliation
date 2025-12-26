const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const goalNumber = '701-7994787872a';

  const transactions = await prisma.bankGoalTransaction.findMany({
    where: { goalNumber },
    select: {
      id: true,
      transactionId: true,
      transactionDate: true,
      transactionType: true,
      totalAmount: true,
      matchedGoalTransactionCode: true,
      reviewTag: true,
    },
    orderBy: { transactionDate: 'asc' },
  });

  console.log(`\nTransactions for goal ${goalNumber}:`);
  console.log('='.repeat(120));
  console.log('TransactionID'.padEnd(35), 'Date'.padEnd(12), 'Type'.padEnd(12), 'Amount'.padEnd(15), 'Matched'.padEnd(10), 'ReviewTag');
  console.log('-'.repeat(120));

  transactions.forEach(t => {
    console.log(
      t.transactionId.padEnd(35),
      t.transactionDate.toISOString().split('T')[0].padEnd(12),
      t.transactionType.padEnd(12),
      Number(t.totalAmount).toFixed(2).padStart(12).padEnd(15),
      (t.matchedGoalTransactionCode ? 'YES' : 'NO').padEnd(10),
      t.reviewTag || '-'
    );
  });

  console.log('\n--- Reversal Analysis ---');
  // Group by amount to find potential pairs
  const byAmount = {};
  transactions.forEach(t => {
    const amt = Number(t.totalAmount).toFixed(2);
    if (!byAmount[amt]) byAmount[amt] = [];
    byAmount[amt].push(t);
  });

  for (const [amount, txns] of Object.entries(byAmount)) {
    const deposits = txns.filter(t => t.transactionType === 'DEPOSIT');
    const withdrawals = txns.filter(t => t.transactionType === 'WITHDRAWAL');

    if (deposits.length > 0 && withdrawals.length > 0) {
      console.log(`\nAmount ${amount}:`);
      console.log('  DEPOSITS:', deposits.map(d => `${d.transactionId} (${d.transactionDate.toISOString().split('T')[0]}, matched=${d.matchedGoalTransactionCode ? 'Y' : 'N'})`).join(', '));
      console.log('  WITHDRAWALS:', withdrawals.map(w => `${w.transactionId} (${w.transactionDate.toISOString().split('T')[0]}, matched=${w.matchedGoalTransactionCode ? 'Y' : 'N'})`).join(', '));
    }
  }
}

main().catch(console.error).finally(() => prisma.$disconnect());
