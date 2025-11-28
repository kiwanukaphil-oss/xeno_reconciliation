import { logger } from '../../../config/logger';
import { config } from '../../../config/env';
import { GoalTransactionCodeGenerator } from '../calculators/GoalTransactionCodeGenerator';
import {
  ParsedFundTransaction,
  TransactionValidationError,
  GoalTransactionGroup,
} from '../../../types/fundTransaction';

/**
 * Validates goal transaction groups (multiple fund transactions linked by goalTransactionCode)
 */
export class GoalTransactionValidator {
  /**
   * Validates goal transaction groups for consistency and completeness
   */
  static validateGoalTransactionGroups(
    transactions: ParsedFundTransaction[]
  ): TransactionValidationError[] {
    logger.info('Validating goal transaction groups');

    const errors: TransactionValidationError[] = [];

    // Group transactions by goalTransactionCode
    const groups = GoalTransactionCodeGenerator.groupByCode(transactions);

    logger.info(`Found ${groups.size} goal transaction groups`);

    // Validate each group
    for (const [code, groupTransactions] of groups.entries()) {
      errors.push(...this.validateGroup(code, groupTransactions));
    }

    return errors;
  }

  /**
   * Validates a single goal transaction group
   */
  private static validateGroup(
    goalTransactionCode: string,
    transactions: ParsedFundTransaction[]
  ): TransactionValidationError[] {
    const errors: TransactionValidationError[] = [];

    // Get the first transaction as reference
    const first = transactions[0];
    const rowNumbers = transactions.map((t) => t.rowNumber);

    // Validation 1: Consistency - All transactions must have same client
    const uniqueClients = new Set(transactions.map((t) => t.clientName));
    if (uniqueClients.size > 1) {
      errors.push({
        rowNumber: first.rowNumber,
        errorCode: 'GOAL_TRANSACTION_SAME_CLIENT',
        message: `Goal transaction ${goalTransactionCode} has multiple clients: ${Array.from(
          uniqueClients
        ).join(', ')}`,
        severity: 'CRITICAL',
        suggestedAction: 'All fund transactions in a goal transaction must have the same client',
        value: { goalTransactionCode, clients: Array.from(uniqueClients), rows: rowNumbers },
      });
    }

    // Validation 2: Consistency - All transactions must have same date
    const uniqueDates = new Set(
      transactions.map((t) => t.transactionDate.toISOString().split('T')[0])
    );
    if (uniqueDates.size > 1) {
      errors.push({
        rowNumber: first.rowNumber,
        errorCode: 'GOAL_TRANSACTION_SAME_DATE',
        message: `Goal transaction ${goalTransactionCode} has multiple dates: ${Array.from(
          uniqueDates
        ).join(', ')}`,
        severity: 'CRITICAL',
        suggestedAction: 'All fund transactions in a goal transaction must have the same date',
        value: { goalTransactionCode, dates: Array.from(uniqueDates), rows: rowNumbers },
      });
    }

    // Validation 3: Consistency - All transactions must have same account
    const uniqueAccounts = new Set(transactions.map((t) => t.accountNumber));
    if (uniqueAccounts.size > 1) {
      errors.push({
        rowNumber: first.rowNumber,
        errorCode: 'GOAL_TRANSACTION_SAME_ACCOUNT',
        message: `Goal transaction ${goalTransactionCode} has multiple accounts: ${Array.from(
          uniqueAccounts
        ).join(', ')}`,
        severity: 'CRITICAL',
        suggestedAction:
          'All fund transactions in a goal transaction must have the same account number',
        value: { goalTransactionCode, accounts: Array.from(uniqueAccounts), rows: rowNumbers },
      });
    }

    // Validation 4: Consistency - All transactions must have same goal
    const uniqueGoals = new Set(transactions.map((t) => t.goalNumber));
    if (uniqueGoals.size > 1) {
      errors.push({
        rowNumber: first.rowNumber,
        errorCode: 'GOAL_TRANSACTION_SAME_GOAL',
        message: `Goal transaction ${goalTransactionCode} has multiple goals: ${Array.from(
          uniqueGoals
        ).join(', ')}`,
        severity: 'CRITICAL',
        suggestedAction:
          'All fund transactions in a goal transaction must have the same goal number',
        value: { goalTransactionCode, goals: Array.from(uniqueGoals), rows: rowNumbers },
      });
    }

    // Validation 4.1: Consistency - All transactions must have same transactionId
    const uniqueTransactionIds = new Set(transactions.map((t) => t.transactionId));
    if (uniqueTransactionIds.size > 1) {
      errors.push({
        rowNumber: first.rowNumber,
        errorCode: 'GOAL_TRANSACTION_SAME_TRANSACTION_ID',
        message: `Goal transaction ${goalTransactionCode} has multiple transaction IDs: ${Array.from(
          uniqueTransactionIds
        ).join(', ')}`,
        severity: 'CRITICAL',
        suggestedAction:
          'All fund transactions in a goal transaction must have the same transaction ID from the source statement',
        value: { goalTransactionCode, transactionIds: Array.from(uniqueTransactionIds), rows: rowNumbers },
      });
    }

    // Validation 4.2: Consistency - All transactions must have same source
    const uniqueSources = new Set(transactions.map((t) => t.source));
    if (uniqueSources.size > 1) {
      errors.push({
        rowNumber: first.rowNumber,
        errorCode: 'GOAL_TRANSACTION_SAME_SOURCE',
        message: `Goal transaction ${goalTransactionCode} has multiple sources: ${Array.from(
          uniqueSources
        ).join(', ')}`,
        severity: 'CRITICAL',
        suggestedAction:
          'All fund transactions in a goal transaction must have the same transaction source/channel',
        value: { goalTransactionCode, sources: Array.from(uniqueSources), rows: rowNumbers },
      });
    }

    // Validation 5: Completeness - Check expected fund count (warning if not 4)
    const expectedFundCount = 4;
    if (transactions.length !== expectedFundCount) {
      errors.push({
        rowNumber: first.rowNumber,
        errorCode: 'GOAL_TRANSACTION_COMPLETE_FUND_SET',
        message: `Goal transaction ${goalTransactionCode} has ${transactions.length} fund transactions (expected ${expectedFundCount})`,
        severity: 'WARNING',
        suggestedAction: `Goal transaction should have ${expectedFundCount} fund transactions`,
        value: {
          goalTransactionCode,
          actual: transactions.length,
          expected: expectedFundCount,
          rows: rowNumbers,
        },
      });
    }

    // Get fund codes for other validations
    const fundCodes = transactions.map((t) => t.fundCode);

    // Validation 6: Check for missing expected funds
    const expectedFunds = ['XUMMF', 'XUBF', 'XUDEF', 'XUREF'];
    const actualFunds = new Set(fundCodes);
    const missingFunds = expectedFunds.filter((f) => !actualFunds.has(f));
    if (missingFunds.length > 0) {
      errors.push({
        rowNumber: first.rowNumber,
        errorCode: 'MISSING_EXPECTED_FUNDS',
        message: `Goal transaction ${goalTransactionCode} missing funds: ${missingFunds.join(
          ', '
        )}`,
        severity: 'WARNING',
        suggestedAction: 'Verify all expected funds are present: XUMMF, XUBF, XUDEF, XUREF',
        value: { goalTransactionCode, missingFunds, actualFunds: Array.from(actualFunds), rows: rowNumbers },
      });
    }

    // Validation 8: Check for zero amounts (negative amounts are allowed for withdrawals)
    const zeroAmounts = transactions.filter((t) => t.amount === 0);
    if (zeroAmounts.length > 0) {
      errors.push({
        rowNumber: first.rowNumber,
        errorCode: 'GOAL_TRANSACTION_ZERO_AMOUNTS',
        message: `Goal transaction ${goalTransactionCode} has zero amounts`,
        severity: 'WARNING',
        suggestedAction: 'Verify that zero amount transactions are intentional',
        value: {
          goalTransactionCode,
          zeroAmounts: zeroAmounts.map((t) => ({
            row: t.rowNumber,
            fund: t.fundCode,
            amount: t.amount,
          })),
        },
      });
    }

    return errors;
  }

  /**
   * Validates fund distribution percentages against goal configuration
   * (This will be called later when we have goal data from database)
   */
  static validateFundDistribution(
    transactions: ParsedFundTransaction[],
    goalFundDistribution: Record<string, number>
  ): TransactionValidationError[] {
    const errors: TransactionValidationError[] = [];

    // Calculate total amount
    const totalAmount = transactions.reduce((sum, t) => sum + t.amount, 0);

    if (totalAmount === 0) {
      return errors; // Skip if no transactions
    }

    const first = transactions[0];
    const goalTransactionCode = first.goalTransactionCode;
    const tolerance = config.validation.fundDistributionTolerance;

    // Check each fund's amount against expected percentage
    for (const transaction of transactions) {
      const expectedPercentage = goalFundDistribution[transaction.fundCode] || 0;

      if (expectedPercentage === 0) {
        // Fund not configured in goal distribution
        errors.push({
          rowNumber: transaction.rowNumber,
          field: 'fundCode',
          errorCode: 'FUND_NOT_IN_DISTRIBUTION',
          message: `Fund ${transaction.fundCode} is not configured in goal distribution`,
          severity: 'WARNING',
          suggestedAction: 'Verify fund code or update goal distribution configuration',
          value: {
            fundCode: transaction.fundCode,
            goalTransactionCode,
          },
        });
        continue;
      }

      const expectedAmount = (totalAmount * expectedPercentage) / 100;
      const actualAmount = transaction.amount;
      const difference = Math.abs(expectedAmount - actualAmount);
      const allowedVariance = totalAmount * tolerance;

      if (difference > allowedVariance) {
        const actualPercentage = (actualAmount / totalAmount) * 100;

        errors.push({
          rowNumber: transaction.rowNumber,
          field: 'amount',
          errorCode: 'FUND_DISTRIBUTION_MATCHES_GOAL',
          message: `Fund ${transaction.fundCode} amount ${actualAmount.toFixed(
            2
          )} doesn't match expected ${expectedAmount.toFixed(2)} (${expectedPercentage}% of ${totalAmount.toFixed(2)})`,
          severity: 'WARNING',
          suggestedAction: `Verify fund amounts match expected distribution (±${
            tolerance * 100
          }% tolerance). Actual: ${actualPercentage.toFixed(2)}%, Expected: ${expectedPercentage}%`,
          value: {
            fundCode: transaction.fundCode,
            goalTransactionCode,
            actualAmount,
            expectedAmount,
            actualPercentage: actualPercentage.toFixed(2),
            expectedPercentage,
            totalAmount,
            difference: difference.toFixed(2),
          },
        });
      }
    }

    return errors;
  }

  /**
   * Gets goal transaction groups with metadata
   */
  static getGoalTransactionGroups(
    transactions: ParsedFundTransaction[]
  ): GoalTransactionGroup[] {
    const groups = GoalTransactionCodeGenerator.groupByCode(transactions);
    const result: GoalTransactionGroup[] = [];

    for (const [code, groupTransactions] of groups.entries()) {
      const first = groupTransactions[0];
      const totalAmount = groupTransactions.reduce((sum, t) => sum + t.amount, 0);

      result.push({
        goalTransactionCode: code,
        fundTransactions: groupTransactions,
        transactionDate: first.transactionDate,
        clientName: first.clientName,
        accountNumber: first.accountNumber,
        goalNumber: first.goalNumber,
        goalTitle: first.goalTitle,
        totalAmount,
        fundCount: groupTransactions.length,
      });
    }

    return result;
  }

  /**
   * Gets statistics about goal transaction groups
   */
  static getGroupStatistics(transactions: ParsedFundTransaction[]): {
    totalGroups: number;
    completeGroups: number; // 4 funds
    incompleteGroups: number; // < 4 funds
    averageFundsPerGroup: number;
  } {
    const groups = GoalTransactionCodeGenerator.groupByCode(transactions);

    let completeGroups = 0;
    let incompleteGroups = 0;
    let totalFunds = 0;

    for (const [, groupTransactions] of groups.entries()) {
      // Check completeness
      if (groupTransactions.length === 4) {
        completeGroups++;
      } else {
        incompleteGroups++;
      }

      totalFunds += groupTransactions.length;
    }

    return {
      totalGroups: groups.size,
      completeGroups,
      incompleteGroups,
      averageFundsPerGroup: groups.size > 0 ? totalFunds / groups.size : 0,
    };
  }
}
