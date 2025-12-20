import { prisma } from '../../../config/database';
import { logger } from '../../../config/logger';
import { MaterializedViewService } from '../../unit-registry/MaterializedViewService';

/**
 * Service for rolling back upload batches
 */
export class BatchRollbackService {
  /**
   * Rollback an upload batch - delete all associated data
   */
  static async rollbackBatch(batchId: string): Promise<{
    success: boolean;
    message: string;
    deletedCounts: {
      fundTransactions: number;
      goals: number;
      accounts: number;
      clients: number;
    };
  }> {
    logger.info(`Starting rollback for batch ${batchId}`);

    try {
      // Get batch info first (outside transaction for validation)
      const batch = await prisma.uploadBatch.findUnique({
        where: { id: batchId },
      });

      if (!batch) {
        throw new Error('Batch not found');
      }

      // Don't allow rollback of batches that are currently processing
      if (['PARSING', 'VALIDATING', 'PROCESSING'].includes(batch.processingStatus)) {
        throw new Error('Cannot rollback a batch that is currently processing. Please wait for it to complete or fail.');
      }

      logger.info(`Batch ${batch.batchNumber} - Status: ${batch.processingStatus}`);

      const deletedCounts = {
        fundTransactions: 0,
        goals: 0,
        accounts: 0,
        clients: 0,
      };

      // Run all deletions in a transaction to ensure atomicity
      await prisma.$transaction(async (tx) => {
        // Step 1: Get all fund transactions for this batch
        const fundTransactions = await tx.fundTransaction.findMany({
          where: { uploadBatchId: batchId },
          select: {
            id: true,
            goalId: true,
            accountId: true,
            clientId: true,
          },
        });

        logger.info(`Found ${fundTransactions.length} fund transactions to delete`);

        if (fundTransactions.length > 0) {
          // Extract unique IDs
          const goalIds = [...new Set(fundTransactions.map(t => t.goalId))];
          const accountIds = [...new Set(fundTransactions.map(t => t.accountId))];
          const clientIds = [...new Set(fundTransactions.map(t => t.clientId))];

          // Step 2: Delete fund transactions
          const deletedTransactions = await tx.fundTransaction.deleteMany({
            where: { uploadBatchId: batchId },
          });
          deletedCounts.fundTransactions = deletedTransactions.count;
          logger.info(`Deleted ${deletedCounts.fundTransactions} fund transactions`);

          // Step 3: Delete orphaned goals (goals with no remaining fund transactions AND no bank transactions)
          for (const goalId of goalIds) {
            const remainingFundTransactions = await tx.fundTransaction.count({
              where: { goalId },
            });

            if (remainingFundTransactions === 0) {
              // Also check if there are any bank_goal_transactions referencing this goal
              const remainingBankTransactions = await tx.bankGoalTransaction.count({
                where: { goalId },
              });

              if (remainingBankTransactions === 0) {
                await tx.goal.delete({ where: { id: goalId } });
                deletedCounts.goals++;
              } else {
                logger.info(`Goal ${goalId} has ${remainingBankTransactions} bank transactions, skipping deletion`);
              }
            }
          }
          logger.info(`Deleted ${deletedCounts.goals} orphaned goals`);

          // Step 4: Delete orphaned accounts (accounts with no remaining goals)
          for (const accountId of accountIds) {
            const remainingGoals = await tx.goal.count({
              where: { accountId },
            });

            if (remainingGoals === 0) {
              await tx.account.delete({ where: { id: accountId } });
              deletedCounts.accounts++;
            }
          }
          logger.info(`Deleted ${deletedCounts.accounts} orphaned accounts`);

          // Step 5: Delete orphaned clients (clients with no remaining accounts)
          for (const clientId of clientIds) {
            const remainingAccounts = await tx.account.count({
              where: { clientId },
            });

            if (remainingAccounts === 0) {
              await tx.client.delete({ where: { id: clientId } });
              deletedCounts.clients++;
            }
          }
          logger.info(`Deleted ${deletedCounts.clients} orphaned clients`);
        }

        // Step 6: Delete invalid transactions if any
        const deletedInvalid = await tx.invalidFundTransaction.deleteMany({
          where: { uploadBatchId: batchId },
        });
        logger.info(`Deleted ${deletedInvalid.count} invalid fund transactions`);

        // Step 7: Delete the upload batch itself
        await tx.uploadBatch.delete({
          where: { id: batchId },
        });
        logger.info(`Deleted upload batch ${batch.batchNumber}`);
      }, {
        timeout: 120000, // 2 minute timeout for large batches
      });

      // Step 8: Refresh all materialized views
      logger.info('Refreshing all materialized views after rollback');
      try {
        const result = await MaterializedViewService.refreshAllViews();
        if (result.success) {
          logger.info(`All materialized views refreshed successfully: ${result.refreshed.join(', ')}`);
        } else {
          logger.warn(`Some materialized views failed to refresh. Succeeded: ${result.refreshed.join(', ')}, Failed: ${result.failed.join(', ')}`);
        }
      } catch (error: any) {
        logger.error('Failed to refresh materialized views:', error);
        // Don't fail the rollback if view refresh fails
      }

      const message = `Batch ${batch.batchNumber} rolled back successfully. ` +
        `Deleted: ${deletedCounts.fundTransactions} transactions, ` +
        `${deletedCounts.goals} goals, ` +
        `${deletedCounts.accounts} accounts, ` +
        `${deletedCounts.clients} clients`;

      logger.info(message);

      return {
        success: true,
        message,
        deletedCounts,
      };
    } catch (error: any) {
      logger.error(`Rollback failed for batch ${batchId}:`, error);
      throw error;
    }
  }

  /**
   * Check if a batch can be rolled back
   */
  static async canRollback(batchId: string): Promise<{
    canRollback: boolean;
    reason?: string;
  }> {
    try {
      const batch = await prisma.uploadBatch.findUnique({
        where: { id: batchId },
      });

      if (!batch) {
        return {
          canRollback: false,
          reason: 'Batch not found',
        };
      }

      if (['PARSING', 'VALIDATING', 'PROCESSING'].includes(batch.processingStatus)) {
        return {
          canRollback: false,
          reason: 'Batch is currently processing',
        };
      }

      return {
        canRollback: true,
      };
    } catch (error: any) {
      logger.error(`Error checking rollback eligibility for batch ${batchId}:`, error);
      return {
        canRollback: false,
        reason: error.message,
      };
    }
  }
}
