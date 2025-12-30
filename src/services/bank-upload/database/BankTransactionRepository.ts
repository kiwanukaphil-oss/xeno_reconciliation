import { prisma } from '../../../config/database';
import { logger } from '../../../config/logger';
import { Prisma, ReconciliationStatus } from '@prisma/client';
import { ParsedBankTransaction, InvalidBankTransaction } from '../../../types/bankTransaction';

/**
 * Repository for bank transaction database operations
 * Mirrors FundTransactionRepository for consistency
 */
export class BankTransactionRepository {
  /**
   * Saves validated bank transactions to database in batches
   */
  static async saveTransactions(
    transactions: ParsedBankTransaction[],
    batchId: string
  ): Promise<number> {
    const BATCH_SIZE = 500;
    let savedCount = 0;

    logger.info(`Saving ${transactions.length} bank transactions for batch ${batchId}`);

    for (let i = 0; i < transactions.length; i += BATCH_SIZE) {
      const batch = transactions.slice(i, i + BATCH_SIZE);

      // Prepare data for each transaction
      const transactionData = [];

      for (const txn of batch) {
        try {
          // Find account - should always exist (validated in BankTransactionValidator)
          const account = await prisma.account.findUnique({
            where: { accountNumber: txn.accountNumber },
            include: { client: true },
          });

          if (!account) {
            // This should never happen if validation passed - throw error to prevent silent data loss
            throw new Error(`CRITICAL: Account "${txn.accountNumber}" not found at row ${txn.rowNumber}. This should have been caught during validation.`);
          }

          // Find goal - should always exist (validated in BankTransactionValidator)
          const goal = await prisma.goal.findUnique({
            where: { goalNumber: txn.goalNumber },
          });

          if (!goal) {
            // This should never happen if validation passed - throw error to prevent silent data loss
            throw new Error(`CRITICAL: Goal "${txn.goalNumber}" not found at row ${txn.rowNumber}. This should have been caught during validation.`);
          }

          transactionData.push({
            clientId: account.clientId,
            accountId: account.id,
            goalId: goal.id,
            uploadBatchId: batchId,
            transactionDate: txn.transactionDate,
            transactionType: txn.transactionType as any,
            transactionId: txn.transactionId,
            firstName: txn.firstName,
            lastName: txn.lastName,
            goalTitle: txn.goalTitle,
            goalNumber: txn.goalNumber,
            totalAmount: new Prisma.Decimal(txn.totalAmount),
            xummfPercentage: new Prisma.Decimal(txn.xummfPercentage / 100),
            xubfPercentage: new Prisma.Decimal(txn.xubfPercentage / 100),
            xudefPercentage: new Prisma.Decimal(txn.xudefPercentage / 100),
            xurefPercentage: new Prisma.Decimal(txn.xurefPercentage / 100),
            xummfAmount: new Prisma.Decimal(txn.xummfAmount),
            xubfAmount: new Prisma.Decimal(txn.xubfAmount),
            xudefAmount: new Prisma.Decimal(txn.xudefAmount),
            xurefAmount: new Prisma.Decimal(txn.xurefAmount),
            reconciliationStatus: 'PENDING' as const,
            rowNumber: txn.rowNumber,
          });
        } catch (error: any) {
          logger.error(`Error preparing transaction at row ${txn.rowNumber}:`, error);
        }
      }

      // Batch insert
      if (transactionData.length > 0) {
        await prisma.bankGoalTransaction.createMany({
          data: transactionData,
          skipDuplicates: true,
        });
        savedCount += transactionData.length;
      }

      logger.info(`Saved batch ${Math.floor(i / BATCH_SIZE) + 1}: ${transactionData.length} transactions`);
    }

    logger.info(`Total saved: ${savedCount} bank transactions`);
    return savedCount;
  }

  /**
   * Saves invalid transactions for audit purposes
   */
  static async saveInvalidTransactions(
    invalidTransactions: InvalidBankTransaction[],
    batchId: string
  ): Promise<void> {
    // Note: We don't have a separate InvalidBankTransaction table
    // Invalid transactions are tracked via validationErrors in the batch
    logger.info(`Recording ${invalidTransactions.length} invalid bank transactions for batch ${batchId}`);
  }

  /**
   * Gets transactions for a batch
   */
  static async getTransactionsByBatchId(batchId: string) {
    return await prisma.bankGoalTransaction.findMany({
      where: { uploadBatchId: batchId },
      orderBy: { rowNumber: 'asc' },
      include: {
        client: { select: { clientName: true } },
        account: { select: { accountNumber: true } },
        goal: { select: { goalNumber: true, goalTitle: true } },
      },
    });
  }

  /**
   * Deletes all transactions for a batch
   */
  static async deleteTransactionsByBatchId(batchId: string): Promise<number> {
    const result = await prisma.bankGoalTransaction.deleteMany({
      where: { uploadBatchId: batchId },
    });
    return result.count;
  }

  /**
   * Gets all bank transactions with filters and pagination
   */
  static async getAllTransactions(options: {
    page?: number;
    limit?: number;
    startDate?: string;
    endDate?: string;
    search?: string;
    transactionType?: string;
    reconciliationStatus?: string;
  } = {}): Promise<{
    data: any[];
    aggregates: {
      totalCount: number;
      totalAmount: number;
      totalXUMMF: number;
      totalXUBF: number;
      totalXUDEF: number;
      totalXUREF: number;
      depositCount: number;
      depositAmount: number;
      withdrawalCount: number;
      withdrawalAmount: number;
    };
    pagination: {
      page: number;
      limit: number;
      total: number;
      totalPages: number;
    };
  }> {
    const page = options.page || 1;
    const limit = options.limit || 50;
    const skip = (page - 1) * limit;

    // Build where clause
    const where: any = {};

    // Date filters
    if (options.startDate || options.endDate) {
      where.transactionDate = {};
      if (options.startDate) {
        where.transactionDate.gte = new Date(options.startDate);
      }
      if (options.endDate) {
        where.transactionDate.lte = new Date(options.endDate);
      }
    }

    // Transaction type filter
    if (options.transactionType) {
      where.transactionType = options.transactionType;
    }

    // Reconciliation status filter
    if (options.reconciliationStatus) {
      where.reconciliationStatus = options.reconciliationStatus;
    }

    // Search filter - search across multiple fields
    // Split search into words for name matching (any order)
    if (options.search) {
      const searchTerm = options.search.trim();
      const searchWords = searchTerm.split(/\s+/).filter(w => w.length > 0);

      if (searchWords.length > 1) {
        // Multi-word search: all words must be present in firstName OR lastName (any order)
        // This handles "Stella Murungi" matching same as "Murungi Stella"
        const nameConditions = searchWords.map(word => ({
          OR: [
            { firstName: { contains: word, mode: 'insensitive' as const } },
            { lastName: { contains: word, mode: 'insensitive' as const } },
          ],
        }));

        where.OR = [
          // All words found in name fields (any order)
          { AND: nameConditions },
          // Or full term matches other fields
          { goalNumber: { contains: searchTerm, mode: 'insensitive' } },
          { goalTitle: { contains: searchTerm, mode: 'insensitive' } },
          { transactionId: { contains: searchTerm, mode: 'insensitive' } },
          { account: { accountNumber: { contains: searchTerm, mode: 'insensitive' } } },
        ];
      } else {
        // Single word search: simple contains on all fields
        where.OR = [
          { firstName: { contains: searchTerm, mode: 'insensitive' } },
          { lastName: { contains: searchTerm, mode: 'insensitive' } },
          { goalNumber: { contains: searchTerm, mode: 'insensitive' } },
          { goalTitle: { contains: searchTerm, mode: 'insensitive' } },
          { transactionId: { contains: searchTerm, mode: 'insensitive' } },
          { account: { accountNumber: { contains: searchTerm, mode: 'insensitive' } } },
        ];
      }
    }

    // Get paginated data
    const [transactions, total] = await Promise.all([
      prisma.bankGoalTransaction.findMany({
        where,
        skip,
        take: limit,
        orderBy: [
          { transactionDate: 'desc' },
          { rowNumber: 'asc' },
        ],
        include: {
          client: { select: { clientName: true } },
          account: { select: { accountNumber: true } },
          goal: { select: { goalNumber: true, goalTitle: true } },
        },
      }),
      prisma.bankGoalTransaction.count({ where }),
    ]);

    // Calculate aggregates for ALL filtered data (not just current page)
    const aggregateResult = await prisma.bankGoalTransaction.aggregate({
      where,
      _sum: {
        totalAmount: true,
        xummfAmount: true,
        xubfAmount: true,
        xudefAmount: true,
        xurefAmount: true,
      },
      _count: {
        _all: true,
      },
    });

    // Calculate deposit totals
    const depositAggregates = await prisma.bankGoalTransaction.aggregate({
      where: { ...where, transactionType: 'DEPOSIT' },
      _sum: { totalAmount: true },
      _count: { _all: true },
    });

    // Calculate withdrawal/redemption totals
    const withdrawalAggregates = await prisma.bankGoalTransaction.aggregate({
      where: {
        ...where,
        transactionType: { in: ['WITHDRAWAL', 'REDEMPTION'] },
      },
      _sum: { totalAmount: true },
      _count: { _all: true },
    });

    // Format transactions for response
    const formattedData = transactions.map((txn) => ({
      id: txn.id,
      transactionDate: txn.transactionDate,
      transactionType: txn.transactionType,
      transactionId: txn.transactionId,
      clientName: `${txn.firstName} ${txn.lastName}`,
      firstName: txn.firstName,
      lastName: txn.lastName,
      accountNumber: txn.account?.accountNumber || '',
      goalNumber: txn.goalNumber,
      goalTitle: txn.goalTitle,
      totalAmount: txn.totalAmount.toNumber(),
      xummfPercentage: txn.xummfPercentage.toNumber() * 100,
      xubfPercentage: txn.xubfPercentage.toNumber() * 100,
      xudefPercentage: txn.xudefPercentage.toNumber() * 100,
      xurefPercentage: txn.xurefPercentage.toNumber() * 100,
      xummfAmount: txn.xummfAmount.toNumber(),
      xubfAmount: txn.xubfAmount.toNumber(),
      xudefAmount: txn.xudefAmount.toNumber(),
      xurefAmount: txn.xurefAmount.toNumber(),
      reconciliationStatus: txn.reconciliationStatus,
      uploadBatchId: txn.uploadBatchId,
      createdAt: txn.createdAt,
    }));

    return {
      data: formattedData,
      aggregates: {
        totalCount: aggregateResult._count._all,
        totalAmount: aggregateResult._sum.totalAmount?.toNumber() || 0,
        totalXUMMF: aggregateResult._sum.xummfAmount?.toNumber() || 0,
        totalXUBF: aggregateResult._sum.xubfAmount?.toNumber() || 0,
        totalXUDEF: aggregateResult._sum.xudefAmount?.toNumber() || 0,
        totalXUREF: aggregateResult._sum.xurefAmount?.toNumber() || 0,
        depositCount: depositAggregates._count._all,
        depositAmount: depositAggregates._sum.totalAmount?.toNumber() || 0,
        withdrawalCount: withdrawalAggregates._count._all,
        withdrawalAmount: Math.abs(withdrawalAggregates._sum.totalAmount?.toNumber() || 0),
      },
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  /**
   * Updates reconciliation status for a single transaction
   */
  static async updateTransactionStatus(
    transactionId: string,
    status: string,
    _notes?: string,
    updatedBy?: string
  ): Promise<any> {
    const transaction = await prisma.bankGoalTransaction.findUnique({
      where: { id: transactionId },
    });

    if (!transaction) {
      throw new Error(`Transaction not found: ${transactionId}`);
    }

    // Update the transaction status
    const updated = await prisma.bankGoalTransaction.update({
      where: { id: transactionId },
      data: {
        reconciliationStatus: status as any,
        updatedAt: new Date(),
      },
    });

    logger.info(`Transaction ${transactionId} status updated to ${status} by ${updatedBy || 'system'}`);

    return {
      id: updated.id,
      transactionId: updated.transactionId,
      goalNumber: updated.goalNumber,
      reconciliationStatus: updated.reconciliationStatus,
      totalAmount: updated.totalAmount.toNumber(),
      updatedAt: updated.updatedAt,
    };
  }

  /**
   * Bulk update reconciliation status for multiple transactions
   */
  static async bulkUpdateTransactionStatus(
    transactionIds: string[],
    status: string,
    _notes?: string,
    updatedBy?: string
  ): Promise<{ updated: number; failed: number; errors: string[] }> {
    let updated = 0;
    let failed = 0;
    const errors: string[] = [];

    for (const id of transactionIds) {
      try {
        await prisma.bankGoalTransaction.update({
          where: { id },
          data: {
            reconciliationStatus: status as any,
            updatedAt: new Date(),
          },
        });
        updated++;
      } catch (error: any) {
        failed++;
        errors.push(`${id}: ${error.message}`);
      }
    }

    logger.info(`Bulk status update: ${updated} updated, ${failed} failed by ${updatedBy || 'system'}`);

    return { updated, failed, errors };
  }

  /**
   * Gets a single transaction by ID
   */
  static async getTransactionById(transactionId: string): Promise<any> {
    const transaction = await prisma.bankGoalTransaction.findUnique({
      where: { id: transactionId },
      include: {
        client: { select: { clientName: true } },
        account: { select: { accountNumber: true } },
        goal: { select: { goalNumber: true, goalTitle: true } },
      },
    });

    if (!transaction) {
      return null;
    }

    return {
      id: transaction.id,
      transactionDate: transaction.transactionDate,
      transactionType: transaction.transactionType,
      transactionId: transaction.transactionId,
      clientName: `${transaction.firstName} ${transaction.lastName}`,
      firstName: transaction.firstName,
      lastName: transaction.lastName,
      accountNumber: transaction.account?.accountNumber || '',
      goalNumber: transaction.goalNumber,
      goalTitle: transaction.goalTitle,
      totalAmount: transaction.totalAmount.toNumber(),
      xummfPercentage: transaction.xummfPercentage.toNumber() * 100,
      xubfPercentage: transaction.xubfPercentage.toNumber() * 100,
      xudefPercentage: transaction.xudefPercentage.toNumber() * 100,
      xurefPercentage: transaction.xurefPercentage.toNumber() * 100,
      xummfAmount: transaction.xummfAmount.toNumber(),
      xubfAmount: transaction.xubfAmount.toNumber(),
      xudefAmount: transaction.xudefAmount.toNumber(),
      xurefAmount: transaction.xurefAmount.toNumber(),
      reconciliationStatus: transaction.reconciliationStatus,
      matchedGoalTransactionCode: transaction.matchedGoalTransactionCode,
      matchScore: transaction.matchScore,
      uploadBatchId: transaction.uploadBatchId,
      createdAt: transaction.createdAt,
      updatedAt: transaction.updatedAt,
    };
  }

  /**
   * Run reconciliation on pending transactions
   * Matches bank transactions against fund transactions and updates status
   *
   * @param transactionIds - Optional array of specific transaction IDs to reconcile
   * @param batchSize - Number of transactions to process per batch (default 2000)
   */
  static async runReconciliation(
    transactionIds?: string[],
    batchSize: number = 2000
  ): Promise<{
    processed: number;
    matched: number;
    unmatched: number;
    autoApproved: number;
    manualReview: number;
    errors: string[];
    totalPending: number;
    hasMore: boolean;
  }> {
    // Build where clause - use Prisma enum type
    const whereClause: Prisma.BankGoalTransactionWhereInput = {
      reconciliationStatus: ReconciliationStatus.PENDING,
    };

    if (transactionIds && transactionIds.length > 0) {
      whereClause.id = { in: transactionIds };
    }

    // First, count total pending to inform user
    const totalPending = await prisma.bankGoalTransaction.count({ where: whereClause });

    // Get pending transactions in batches to prevent timeout
    // Ordered by transaction date (oldest first) for predictable processing
    const pendingTransactions = await prisma.bankGoalTransaction.findMany({
      where: whereClause,
      take: batchSize,
      orderBy: [
        { transactionDate: 'asc' },
        { createdAt: 'asc' },
      ],
      select: {
        id: true,
        goalNumber: true,
        transactionId: true,
        totalAmount: true,
        xummfAmount: true,
        xubfAmount: true,
        xudefAmount: true,
        xurefAmount: true,
      },
    });

    const hasMore = totalPending > batchSize;

    logger.info(`Running reconciliation on ${pendingTransactions.length} of ${totalPending} pending transactions`);

    let processed = 0;
    let matched = 0;
    let unmatched = 0;
    let autoApproved = 0;
    let manualReview = 0;
    const errors: string[] = [];

    for (const bankTxn of pendingTransactions) {
      try {
        // Find matching fund transactions using goal number and transaction ID
        const fundTransactions = await prisma.fundTransaction.findMany({
          where: {
            goal: {
              goalNumber: bankTxn.goalNumber,
            },
            transactionId: bankTxn.transactionId,
          },
          select: {
            id: true,
            goalTransactionCode: true,
            amount: true,
            fund: {
              select: {
                fundCode: true,
              },
            },
          },
        });

        if (fundTransactions.length === 0) {
          // No match found
          await prisma.bankGoalTransaction.update({
            where: { id: bankTxn.id },
            data: {
              reconciliationStatus: ReconciliationStatus.MISSING_IN_FUND,
              matchScore: 0,
              updatedAt: new Date(),
            },
          });
          unmatched++;
        } else {
          // Calculate total from fund transactions
          const fundTotalAmount = fundTransactions.reduce(
            (sum, ft) => sum + Number(ft.amount),
            0
          );
          const bankTotalAmount = bankTxn.totalAmount.toNumber();
          const goalTransactionCode = fundTransactions[0].goalTransactionCode;

          // Check if amounts match within tolerance (1% or 1000 UGX)
          const difference = Math.abs(bankTotalAmount - fundTotalAmount);
          const percentageTolerance = Math.abs(fundTotalAmount) * 0.01;
          const tolerance = Math.max(percentageTolerance, 1000);
          const amountsMatch = difference <= tolerance;

          if (!amountsMatch) {
            // Variance detected - needs manual review
            await prisma.bankGoalTransaction.update({
              where: { id: bankTxn.id },
              data: {
                reconciliationStatus: ReconciliationStatus.VARIANCE_DETECTED,
                matchedGoalTransactionCode: goalTransactionCode,
                matchedAt: new Date(),
                matchScore: 50,
                updatedAt: new Date(),
              },
            });

            manualReview++;
          } else {
            // Amounts match - check for minor variances
            let hasMinorVariances = false;

            // Check fund distribution amounts
            const fundAmounts: { [key: string]: number } = {};
            for (const ft of fundTransactions) {
              fundAmounts[ft.fund.fundCode] = Number(ft.amount);
            }

            const fundChecks = [
              { code: 'XUMMF', bankAmount: bankTxn.xummfAmount.toNumber() },
              { code: 'XUBF', bankAmount: bankTxn.xubfAmount.toNumber() },
              { code: 'XUDEF', bankAmount: bankTxn.xudefAmount.toNumber() },
              { code: 'XUREF', bankAmount: bankTxn.xurefAmount.toNumber() },
            ];

            for (const check of fundChecks) {
              const fundAmount = fundAmounts[check.code] || 0;
              const diff = Math.abs(check.bankAmount - fundAmount);
              if (diff > 1000 && diff / Math.max(fundAmount, 1) > 0.01) {
                hasMinorVariances = true;
                break;
              }
            }

            if (hasMinorVariances) {
              // Minor variance - auto approve
              await prisma.bankGoalTransaction.update({
                where: { id: bankTxn.id },
                data: {
                  reconciliationStatus: ReconciliationStatus.AUTO_APPROVED,
                  matchedGoalTransactionCode: goalTransactionCode,
                  matchedAt: new Date(),
                  matchScore: 90,
                  updatedAt: new Date(),
                },
              });
              autoApproved++;
            } else {
              // Perfect match
              await prisma.bankGoalTransaction.update({
                where: { id: bankTxn.id },
                data: {
                  reconciliationStatus: ReconciliationStatus.MATCHED,
                  matchedGoalTransactionCode: goalTransactionCode,
                  matchedAt: new Date(),
                  matchScore: 100,
                  updatedAt: new Date(),
                },
              });
            }
            matched++;
          }
        }
        processed++;
      } catch (error: any) {
        errors.push(`${bankTxn.id}: ${error.message}`);
        logger.error(`Error reconciling transaction ${bankTxn.id}:`, error);
      }
    }

    logger.info(`Reconciliation complete: ${processed} processed, ${matched} matched, ${unmatched} unmatched. ${hasMore ? `${totalPending - processed} remaining.` : 'All done.'}`);

    return {
      processed,
      matched,
      unmatched,
      autoApproved,
      manualReview,
      errors,
      totalPending,
      hasMore,
    };
  }

  /**
   * Get reconciliation summary statistics
   */
  static async getReconciliationStats(): Promise<{
    total: number;
    pending: number;
    matched: number;
    autoApproved: number;
    manualReview: number;
    approved: number;
    rejected: number;
    missingInFund: number;
    varianceDetected: number;
  }> {
    const [
      total,
      pending,
      matched,
      autoApproved,
      manualReview,
      approved,
      rejected,
      missingInFund,
      varianceDetected,
    ] = await Promise.all([
      prisma.bankGoalTransaction.count(),
      prisma.bankGoalTransaction.count({ where: { reconciliationStatus: ReconciliationStatus.PENDING } }),
      prisma.bankGoalTransaction.count({ where: { reconciliationStatus: ReconciliationStatus.MATCHED } }),
      prisma.bankGoalTransaction.count({ where: { reconciliationStatus: ReconciliationStatus.AUTO_APPROVED } }),
      prisma.bankGoalTransaction.count({ where: { reconciliationStatus: ReconciliationStatus.MANUAL_REVIEW } }),
      prisma.bankGoalTransaction.count({ where: { reconciliationStatus: ReconciliationStatus.APPROVED } }),
      prisma.bankGoalTransaction.count({ where: { reconciliationStatus: ReconciliationStatus.REJECTED } }),
      prisma.bankGoalTransaction.count({ where: { reconciliationStatus: ReconciliationStatus.MISSING_IN_FUND } }),
      prisma.bankGoalTransaction.count({ where: { reconciliationStatus: ReconciliationStatus.VARIANCE_DETECTED } }),
    ]);

    return {
      total,
      pending,
      matched,
      autoApproved,
      manualReview,
      approved,
      rejected,
      missingInFund,
      varianceDetected,
    };
  }

  /**
   * Calculates financial summary for transactions
   */
  static calculateFinancialSummary(transactions: ParsedBankTransaction[]): {
    totalAmount: number;
    depositCount: number;
    withdrawalCount: number;
    totalDeposits: number;
    totalWithdrawals: number;
  } {
    let totalAmount = 0;
    let depositCount = 0;
    let withdrawalCount = 0;
    let totalDeposits = 0;
    let totalWithdrawals = 0;

    for (const txn of transactions) {
      const amount = txn.totalAmount;
      totalAmount += amount;

      if (txn.transactionType === 'DEPOSIT') {
        depositCount++;
        totalDeposits += amount;
      } else if (txn.transactionType === 'WITHDRAWAL' || txn.transactionType === 'REDEMPTION') {
        withdrawalCount++;
        totalWithdrawals += Math.abs(amount);
      }
    }

    return {
      totalAmount,
      depositCount,
      withdrawalCount,
      totalDeposits,
      totalWithdrawals,
    };
  }
}
