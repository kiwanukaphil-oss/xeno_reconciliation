const { PrismaClient, Prisma } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const goalNumber = '701-7994787872a';

  // Get the unmatched deposit we want to find reversal for
  const sourceTransaction = await prisma.bankGoalTransaction.findFirst({
    where: {
      goalNumber,
      transactionId: { contains: 'S23816901' },
    },
  });

  if (!sourceTransaction) {
    console.log('Source transaction not found!');
    return;
  }

  console.log('Source Transaction:');
  console.log('  ID:', sourceTransaction.id);
  console.log('  TransactionId:', sourceTransaction.transactionId);
  console.log('  Type:', sourceTransaction.transactionType);
  console.log('  Amount:', Number(sourceTransaction.totalAmount));
  console.log('  GoalNumber:', sourceTransaction.goalNumber);
  console.log('  Matched:', sourceTransaction.matchedGoalTransactionCode ? 'YES' : 'NO');

  // Calculate what we're looking for
  const sourceAmount = Number(sourceTransaction.totalAmount);
  const targetAmount = -sourceAmount;
  const oppositeType = sourceTransaction.transactionType === 'DEPOSIT' ? 'WITHDRAWAL' : 'DEPOSIT';

  console.log('\nSearching for:');
  console.log('  Opposite Type:', oppositeType);
  console.log('  Target Amount:', targetAmount);
  console.log('  Same Goal:', goalNumber);

  // Convert to Prisma Decimal for proper comparison
  const targetAmountDecimal = new Prisma.Decimal(targetAmount);
  console.log('  Target Amount (Decimal):', targetAmountDecimal.toString());

  // Try to find candidates manually
  const candidates = await prisma.bankGoalTransaction.findMany({
    where: {
      id: { not: sourceTransaction.id },
      goalNumber: sourceTransaction.goalNumber,
      transactionType: oppositeType,
      totalAmount: targetAmountDecimal,
      matchedGoalTransactionCode: null,
      // Include null tags OR non-REVERSAL_NETTED tags
      OR: [
        { reviewTag: null },
        { reviewTag: { not: 'REVERSAL_NETTED' } },
      ],
    },
  });

  console.log('\nCandidates found:', candidates.length);
  candidates.forEach(c => {
    console.log('  -', c.transactionId, c.transactionDate.toISOString().split('T')[0], c.transactionType, Number(c.totalAmount));
  });

  // Let's also check what withdrawals exist for this goal
  console.log('\n--- All withdrawals for this goal ---');
  const allWithdrawals = await prisma.bankGoalTransaction.findMany({
    where: {
      goalNumber,
      transactionType: 'WITHDRAWAL',
    },
  });
  allWithdrawals.forEach(w => {
    console.log('  -', w.transactionId, w.transactionDate.toISOString().split('T')[0], 'Amount:', Number(w.totalAmount), 'Matched:', w.matchedGoalTransactionCode ? 'Y' : 'N', 'Tag:', w.reviewTag || '-');
  });

  // Check if amounts are exactly equal (decimal precision issue?)
  console.log('\n--- Decimal comparison ---');
  console.log('Source amount (Number):', sourceAmount);
  console.log('Target amount (Number):', targetAmount);
  console.log('Target amount (Decimal used in query):', targetAmountDecimal.toString());

  // Try raw query
  console.log('\n--- Raw query test ---');
  const rawResults = await prisma.$queryRaw`
    SELECT id, "transactionId", "transactionType", "totalAmount"::text, "matchedGoalTransactionCode", "reviewTag"
    FROM "BankGoalTransaction"
    WHERE "goalNumber" = ${goalNumber}
      AND "transactionType" = 'WITHDRAWAL'
      AND "totalAmount" = ${targetAmount}
  `;
  console.log('Raw query results:', rawResults.length);
  rawResults.forEach(r => console.log('  -', r));
}

main().catch(console.error).finally(() => prisma.$disconnect());
