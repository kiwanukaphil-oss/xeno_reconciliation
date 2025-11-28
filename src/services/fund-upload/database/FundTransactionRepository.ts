import { prisma } from '../../../config/database';
import { logger } from '../../../config/logger';
import { config } from '../../../config/env';
import { ParsedFundTransaction, TransactionValidationError } from '../../../types/fundTransaction';
import { Prisma } from '@prisma/client';

/**
 * Manages fund transaction database operations
 */
export class FundTransactionRepository {
  /**
   * Saves valid fund transactions to database in batches
   */
  static async saveTransactions(
    transactions: ParsedFundTransaction[],
    uploadBatchId: string
  ): Promise<number> {
    logger.info(`Saving ${transactions.length} fund transactions to database`);

    const batchSize = config.processing.batchInsertSize;
    let savedCount = 0;

    // Process in batches for performance
    for (let i = 0; i < transactions.length; i += batchSize) {
      const batch = transactions.slice(i, i + batchSize);

      try {
        await this.saveBatch(batch, uploadBatchId);
        savedCount += batch.length;

        logger.info(
          `Saved batch ${Math.floor(i / batchSize) + 1}: ${batch.length} transactions (${savedCount}/${transactions.length})`
        );
      } catch (error) {
        logger.error(`Error saving batch starting at index ${i}:`, error);
        throw error;
      }
    }

    logger.info(`Successfully saved ${savedCount} fund transactions`);
    return savedCount;
  }

  /**
   * Saves a batch of transactions (called internally)
   */
  private static async saveBatch(
    transactions: ParsedFundTransaction[],
    uploadBatchId: string
  ): Promise<void> {
    // First, resolve all foreign keys (client, account, goal, fund)
    const resolvedTransactions = await this.resolveForeignKeys(transactions);

    // Create transaction records
    const createData = resolvedTransactions.map((txn) => ({
      fundTransactionId: txn.fundTransactionId,
      goalTransactionCode: txn.goalTransactionCode,
      transactionId: txn.transactionId,
      source: txn.source as any,
      clientId: txn.clientId,
      accountId: txn.accountId,
      goalId: txn.goalId,
      fundId: txn.fundId,
      uploadBatchId,
      transactionDate: txn.transactionDate,
      dateCreated: txn.dateCreated,
      transactionType: txn.transactionType as any,
      amount: new Prisma.Decimal(txn.amount),
      units: new Prisma.Decimal(txn.units),
      bidPrice: new Prisma.Decimal(txn.bidPrice),
      offerPrice: new Prisma.Decimal(txn.offerPrice),
      midPrice: new Prisma.Decimal(txn.midPrice),
      priceDate: txn.transactionDate, // Use transaction date as price date
      rowNumber: txn.rowNumber,
    }));

    // Batch insert
    await prisma.fundTransaction.createMany({
      data: createData,
      skipDuplicates: true, // Skip if duplicate (uploadBatchId, rowNumber)
    });
  }

  /**
   * Resolves foreign keys for transactions
   */
  private static async resolveForeignKeys(
    transactions: ParsedFundTransaction[]
  ): Promise<
    Array<
      ParsedFundTransaction & {
        clientId: string;
        accountId: string;
        goalId: string;
        fundId: string;
      }
    >
  > {
    // Get unique values
    const clientNames = [...new Set(transactions.map((t) => t.clientName))];
    const accountNumbers = [...new Set(transactions.map((t) => t.accountNumber))];
    const goalNumbers = [...new Set(transactions.map((t) => t.goalNumber))];
    const fundCodes = [...new Set(transactions.map((t) => t.fundCode))];

    // Fetch all entities in parallel
    const [clients, accounts, goals, funds] = await Promise.all([
      prisma.client.findMany({
        where: { clientName: { in: clientNames } },
        select: { id: true, clientName: true },
      }),
      prisma.account.findMany({
        where: { accountNumber: { in: accountNumbers } },
        select: { id: true, accountNumber: true },
      }),
      prisma.goal.findMany({
        where: { goalNumber: { in: goalNumbers } },
        select: { id: true, goalNumber: true },
      }),
      prisma.fund.findMany({
        where: { fundCode: { in: fundCodes } },
        select: { id: true, fundCode: true },
      }),
    ]);

    // Create lookup maps
    const clientMap = new Map(clients.map((c) => [c.clientName, c.id]));
    const accountMap = new Map(accounts.map((a) => [a.accountNumber, a.id]));
    const goalMap = new Map(goals.map((g) => [g.goalNumber, g.id]));
    const fundMap = new Map(funds.map((f) => [f.fundCode, f.id]));

    // Resolve each transaction
    const resolved = transactions.map((txn) => {
      const clientId = clientMap.get(txn.clientName);
      const accountId = accountMap.get(txn.accountNumber);
      const goalId = goalMap.get(txn.goalNumber);
      const fundId = fundMap.get(txn.fundCode);

      if (!clientId || !accountId || !goalId || !fundId) {
        throw new Error(
          `Missing foreign key for transaction row ${txn.rowNumber}: ` +
            `client=${!!clientId}, account=${!!accountId}, goal=${!!goalId}, fund=${!!fundId}`
        );
      }

      return {
        ...txn,
        clientId,
        accountId,
        goalId,
        fundId,
      };
    });

    return resolved;
  }

  /**
   * Saves invalid transactions for audit trail
   */
  static async saveInvalidTransactions(
    invalidTransactions: Array<{
      transaction: ParsedFundTransaction;
      errors: TransactionValidationError[];
    }>,
    uploadBatchId: string
  ): Promise<number> {
    logger.info(`Saving ${invalidTransactions.length} invalid transactions`);

    if (invalidTransactions.length === 0) {
      return 0;
    }

    const batchSize = 1000;
    let savedCount = 0;

    for (let i = 0; i < invalidTransactions.length; i += batchSize) {
      const batch = invalidTransactions.slice(i, i + batchSize);

      const createData = batch.map((item) => ({
        uploadBatchId,
        rowNumber: item.transaction.rowNumber,
        rawData: item.transaction as any,
        validationErrors: item.errors as any,
      }));

      await prisma.invalidFundTransaction.createMany({
        data: createData,
        skipDuplicates: true,
      });

      savedCount += batch.length;
    }

    logger.info(`Saved ${savedCount} invalid transactions`);
    return savedCount;
  }

  /**
   * Calculates financial summary from transactions
   */
  static calculateFinancialSummary(transactions: ParsedFundTransaction[]): {
    totalDepositAmount: number;
    totalWithdrawalAmount: number;
    totalUnitsIssued: number;
    totalUnitsRedeemed: number;
    fundBreakdown: Record<string, any>;
  } {
    let totalDepositAmount = 0;
    let totalWithdrawalAmount = 0;
    let totalUnitsIssued = 0;
    let totalUnitsRedeemed = 0;

    const fundBreakdown: Record<
      string,
      {
        transactions: number;
        totalAmount: number;
        totalUnits: number;
        deposits: number;
        withdrawals: number;
      }
    > = {};

    for (const txn of transactions) {
      // Fund breakdown
      if (!fundBreakdown[txn.fundCode]) {
        fundBreakdown[txn.fundCode] = {
          transactions: 0,
          totalAmount: 0,
          totalUnits: 0,
          deposits: 0,
          withdrawals: 0,
        };
      }

      fundBreakdown[txn.fundCode].transactions++;
      fundBreakdown[txn.fundCode].totalAmount += txn.amount;
      fundBreakdown[txn.fundCode].totalUnits += txn.units;

      // Overall totals
      if (txn.transactionType === 'DEPOSIT') {
        totalDepositAmount += txn.amount;
        totalUnitsIssued += txn.units;
        fundBreakdown[txn.fundCode].deposits++;
      } else if (txn.transactionType === 'WITHDRAWAL' || txn.transactionType === 'REDEMPTION') {
        totalWithdrawalAmount += txn.amount;
        totalUnitsRedeemed += txn.units;
        fundBreakdown[txn.fundCode].withdrawals++;
      }
    }

    return {
      totalDepositAmount,
      totalWithdrawalAmount,
      totalUnitsIssued,
      totalUnitsRedeemed,
      fundBreakdown,
    };
  }

  /**
   * Gets transactions by batch ID
   */
  static async getTransactionsByBatchId(batchId: string) {
    return await prisma.fundTransaction.findMany({
      where: { uploadBatchId: batchId },
      include: {
        client: true,
        account: true,
        goal: true,
        fund: true,
      },
      orderBy: [{ transactionDate: 'desc' }, { rowNumber: 'asc' }],
    });
  }

  /**
   * Gets invalid transactions by batch ID
   */
  static async getInvalidTransactionsByBatchId(batchId: string) {
    return await prisma.invalidFundTransaction.findMany({
      where: { uploadBatchId: batchId },
      orderBy: { rowNumber: 'asc' },
    });
  }

  /**
   * Deletes transactions by batch ID (for cancellation)
   */
  static async deleteTransactionsByBatchId(batchId: string): Promise<number> {
    const result = await prisma.fundTransaction.deleteMany({
      where: { uploadBatchId: batchId },
    });

    await prisma.invalidFundTransaction.deleteMany({
      where: { uploadBatchId: batchId },
    });

    logger.info(`Deleted ${result.count} transactions for batch ${batchId}`);
    return result.count;
  }
}
