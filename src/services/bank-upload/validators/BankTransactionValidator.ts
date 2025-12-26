import { logger } from '../../../config/logger';
import { ParsedBankTransaction, InvalidBankTransaction, ValidationError } from '../../../types/bankTransaction';
import { prisma } from '../../../config/database';

/**
 * Validates bank transactions
 * Mirrors FundTransactionValidator for consistency
 */
export class BankTransactionValidator {
  /**
   * Valid transaction types
   */
  private static readonly VALID_TRANSACTION_TYPES = [
    'DEPOSIT',
    'WITHDRAWAL',
    'REDEMPTION',
    'SWITCH',
    'DIVIDEND',
    'TRANSFER',
  ];

  /**
   * Validates a batch of bank transactions
   * Only CRITICAL errors block upload - WARNINGs are tracked for reconciliation
   *
   * IMPORTANT: This method checks that accounts and goals exist in the database.
   * Missing account/goal is a CRITICAL error that blocks the entire upload.
   */
  static async validateBatch(transactions: ParsedBankTransaction[]): Promise<{
    validTransactions: ParsedBankTransaction[];
    invalidTransactions: InvalidBankTransaction[];
    allErrors: ValidationError[];
    transactionsWithWarnings: { transaction: ParsedBankTransaction; warnings: ValidationError[] }[];
  }> {
    const validTransactions: ParsedBankTransaction[] = [];
    const invalidTransactions: InvalidBankTransaction[] = [];
    const allErrors: ValidationError[] = [];
    const transactionsWithWarnings: { transaction: ParsedBankTransaction; warnings: ValidationError[] }[] = [];

    // Pre-fetch all unique account numbers and goal numbers for batch lookup
    const uniqueAccountNumbers = [...new Set(transactions.map(t => t.accountNumber).filter(Boolean))];
    const uniqueGoalNumbers = [...new Set(transactions.map(t => t.goalNumber).filter(Boolean))];

    // Batch lookup accounts and goals
    const existingAccounts = await prisma.account.findMany({
      where: { accountNumber: { in: uniqueAccountNumbers } },
      select: { accountNumber: true },
    });
    const existingGoals = await prisma.goal.findMany({
      where: { goalNumber: { in: uniqueGoalNumbers } },
      select: { goalNumber: true },
    });

    // Create case-insensitive lookup maps (lowercase -> actual value in DB)
    // This allows matching "701-4771873402A" to "701-4771873402a" in the database
    const accountLookup = new Map<string, string>();
    existingAccounts.forEach(a => accountLookup.set(a.accountNumber.toLowerCase(), a.accountNumber));

    const goalLookup = new Map<string, string>();
    existingGoals.forEach(g => goalLookup.set(g.goalNumber.toLowerCase(), g.goalNumber));

    // Check for missing entities (case-insensitive)
    const missingAccounts = uniqueAccountNumbers.filter(a => !accountLookup.has(a.toLowerCase()));
    const missingGoals = uniqueGoalNumbers.filter(g => !goalLookup.has(g.toLowerCase()));

    if (missingAccounts.length > 0) {
      logger.warn(`Missing accounts in database: ${missingAccounts.join(', ')}`);
    }
    if (missingGoals.length > 0) {
      logger.warn(`Missing goals in database: ${missingGoals.join(', ')}`);
    }

    for (const transaction of transactions) {
      const errors = this.validateTransaction(transaction);

      // Check if account exists in database (case-insensitive)
      if (transaction.accountNumber) {
        const normalizedAccount = accountLookup.get(transaction.accountNumber.toLowerCase());
        if (!normalizedAccount) {
          errors.push(this.createError(
            transaction.rowNumber,
            'accountNumber',
            transaction.accountNumber,
            'ACCOUNT_NOT_FOUND',
            `Account "${transaction.accountNumber}" does not exist in the system`,
            'CRITICAL',
            'Create the account first or verify the account number is correct'
          ));
        } else if (normalizedAccount !== transaction.accountNumber) {
          // Normalize account number to match database value (case normalization)
          logger.debug(`Normalizing account number from "${transaction.accountNumber}" to "${normalizedAccount}"`);
          transaction.accountNumber = normalizedAccount;
        }
      }

      // Check if goal exists in database (case-insensitive)
      if (transaction.goalNumber) {
        const normalizedGoal = goalLookup.get(transaction.goalNumber.toLowerCase());
        if (!normalizedGoal) {
          errors.push(this.createError(
            transaction.rowNumber,
            'goalNumber',
            transaction.goalNumber,
            'GOAL_NOT_FOUND',
            `Goal "${transaction.goalNumber}" does not exist in the system`,
            'CRITICAL',
            'Create the goal first or verify the goal number is correct'
          ));
        } else if (normalizedGoal !== transaction.goalNumber) {
          // Normalize goal number to match database value (case normalization)
          logger.debug(`Normalizing goal number from "${transaction.goalNumber}" to "${normalizedGoal}"`);
          transaction.goalNumber = normalizedGoal;
        }
      }

      allErrors.push(...errors);

      // Separate CRITICAL errors from WARNINGs
      const criticalErrors = errors.filter((e) => e.severity === 'CRITICAL');
      const warnings = errors.filter((e) => e.severity === 'WARNING' || e.severity === 'INFO');

      if (criticalErrors.length > 0) {
        // Only CRITICAL errors make a transaction invalid
        invalidTransactions.push({
          transaction,
          errors: criticalErrors,
        });
      } else {
        // Transaction is valid - but track any warnings for reconciliation
        validTransactions.push(transaction);
        if (warnings.length > 0) {
          transactionsWithWarnings.push({
            transaction,
            warnings,
          });
        }
      }
    }

    logger.info(`Bank validation complete: ${validTransactions.length} valid, ${invalidTransactions.length} invalid, ${transactionsWithWarnings.length} with warnings`);

    return {
      validTransactions,
      invalidTransactions,
      allErrors,
      transactionsWithWarnings,
    };
  }

  /**
   * Validates a single transaction
   */
  static validateTransaction(txn: ParsedBankTransaction): ValidationError[] {
    const errors: ValidationError[] = [];

    // Required field validations
    if (!txn.transactionDate) {
      errors.push(this.createError(
        txn.rowNumber,
        'transactionDate',
        txn.transactionDate,
        'REQUIRED_FIELD',
        'Transaction date is required',
        'CRITICAL',
        'Provide a valid transaction date'
      ));
    }

    if (!txn.firstName && !txn.lastName) {
      errors.push(this.createError(
        txn.rowNumber,
        'firstName/lastName',
        `${txn.firstName} ${txn.lastName}`,
        'REQUIRED_FIELD',
        'Client name (first name or last name) is required',
        'CRITICAL',
        'Provide client first name and/or last name'
      ));
    }

    if (!txn.accountNumber) {
      errors.push(this.createError(
        txn.rowNumber,
        'accountNumber',
        txn.accountNumber,
        'REQUIRED_FIELD',
        'Account number is required',
        'CRITICAL',
        'Provide a valid account number'
      ));
    }

    if (!txn.goalNumber) {
      errors.push(this.createError(
        txn.rowNumber,
        'goalNumber',
        txn.goalNumber,
        'REQUIRED_FIELD',
        'Goal number is required',
        'CRITICAL',
        'Provide a valid goal number'
      ));
    }

    if (!txn.transactionId) {
      errors.push(this.createError(
        txn.rowNumber,
        'transactionId',
        txn.transactionId,
        'REQUIRED_FIELD',
        'Transaction ID is required',
        'CRITICAL',
        'Provide a valid transaction ID'
      ));
    }

    // Transaction type validation
    if (!txn.transactionType) {
      errors.push(this.createError(
        txn.rowNumber,
        'transactionType',
        txn.transactionType,
        'REQUIRED_FIELD',
        'Transaction type is required',
        'CRITICAL',
        'Provide a valid transaction type (DEPOSIT, WITHDRAWAL, etc.)'
      ));
    } else if (!this.VALID_TRANSACTION_TYPES.includes(txn.transactionType.toUpperCase())) {
      errors.push(this.createError(
        txn.rowNumber,
        'transactionType',
        txn.transactionType,
        'INVALID_VALUE',
        `Invalid transaction type: ${txn.transactionType}`,
        'CRITICAL',
        `Use one of: ${this.VALID_TRANSACTION_TYPES.join(', ')}`
      ));
    }

    // Amount validation
    if (txn.totalAmount === null || txn.totalAmount === undefined) {
      errors.push(this.createError(
        txn.rowNumber,
        'totalAmount',
        txn.totalAmount,
        'REQUIRED_FIELD',
        'Total amount is required',
        'CRITICAL',
        'Provide a valid total amount'
      ));
    } else if (txn.totalAmount === 0) {
      errors.push(this.createError(
        txn.rowNumber,
        'totalAmount',
        txn.totalAmount,
        'INVALID_VALUE',
        'Total amount cannot be zero',
        'CRITICAL',
        'Provide a non-zero amount'
      ));
    }

    // Date validation
    if (txn.transactionDate) {
      const today = new Date();
      today.setHours(23, 59, 59, 999);

      // Format the parsed date for error message
      const parsedDateStr = txn.transactionDate.toLocaleDateString('en-GB', {
        day: '2-digit',
        month: 'short',
        year: 'numeric'
      });

      if (txn.transactionDate > today) {
        // Calculate how many days in the future
        const daysInFuture = Math.ceil((txn.transactionDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));

        errors.push(this.createError(
          txn.rowNumber,
          'transactionDate',
          parsedDateStr,
          'FUTURE_DATE',
          `Transaction date (${parsedDateStr}) is ${daysInFuture} day(s) in the future`,
          'CRITICAL',
          `Today is ${today.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}. Check if the date format was parsed correctly.`
        ));
      }

      // Check if date is too old (more than 10 years)
      const tenYearsAgo = new Date();
      tenYearsAgo.setFullYear(tenYearsAgo.getFullYear() - 10);

      if (txn.transactionDate < tenYearsAgo) {
        errors.push(this.createError(
          txn.rowNumber,
          'transactionDate',
          parsedDateStr,
          'DATE_TOO_OLD',
          `Transaction date (${parsedDateStr}) is more than 10 years old`,
          'WARNING',
          'Verify the transaction date is correct'
        ));
      }
    }

    // Fund distribution validation - only if percentages look reasonable
    const totalPercentage =
      (txn.xummfPercentage || 0) +
      (txn.xubfPercentage || 0) +
      (txn.xudefPercentage || 0) +
      (txn.xurefPercentage || 0);

    // Only validate percentages if they're in a reasonable range (0-400%)
    // If sum is huge (like 1000000), it means amounts were mistakenly parsed as percentages
    if (totalPercentage > 0 && totalPercentage <= 400) {
      if (Math.abs(totalPercentage - 100) > 5) {
        errors.push(this.createError(
          txn.rowNumber,
          'fundPercentages',
          `XUMMF:${txn.xummfPercentage?.toFixed(1)}% + XUBF:${txn.xubfPercentage?.toFixed(1)}% + XUDEF:${txn.xudefPercentage?.toFixed(1)}% + XUREF:${txn.xurefPercentage?.toFixed(1)}% = ${totalPercentage.toFixed(1)}%`,
          'PERCENTAGE_SUM_MISMATCH',
          `Fund percentages sum to ${totalPercentage.toFixed(1)}% (expected ~100%)`,
          'WARNING',
          'Verify fund percentage columns contain values 0-100'
        ));
      }
    }

    // Validate fund amounts match total (if amounts provided)
    const totalFundAmount =
      Math.abs(txn.xummfAmount || 0) +
      Math.abs(txn.xubfAmount || 0) +
      Math.abs(txn.xudefAmount || 0) +
      Math.abs(txn.xurefAmount || 0);

    if (totalFundAmount > 0 && txn.totalAmount !== null && txn.totalAmount !== 0) {
      const expectedTotal = Math.abs(txn.totalAmount);
      const tolerance = expectedTotal * 0.02; // 2% tolerance

      if (Math.abs(totalFundAmount - expectedTotal) > tolerance) {
        errors.push(this.createError(
          txn.rowNumber,
          'fundAmounts',
          `XUMMF:${txn.xummfAmount} + XUBF:${txn.xubfAmount} + XUDEF:${txn.xudefAmount} + XUREF:${txn.xurefAmount} = ${totalFundAmount.toFixed(0)} vs Total:${expectedTotal.toFixed(0)}`,
          'AMOUNT_SUM_MISMATCH',
          `Fund amounts sum (${totalFundAmount.toLocaleString()}) differs from total amount (${expectedTotal.toLocaleString()})`,
          'WARNING',
          'Verify fund amount columns sum to total amount'
        ));
      }
    }

    return errors;
  }

  /**
   * Creates a validation error object
   */
  private static createError(
    rowNumber: number,
    field: string,
    value: any,
    errorCode: string,
    message: string,
    severity: 'CRITICAL' | 'WARNING' | 'INFO',
    suggestedAction: string
  ): ValidationError {
    return {
      rowNumber,
      field,
      value,
      errorCode,
      message,
      severity,
      suggestedAction,
    };
  }

  /**
   * Gets validation statistics
   */
  static getValidationStats(errors: ValidationError[]): {
    totalErrors: number;
    criticalCount: number;
    warningCount: number;
    byErrorCode: { [code: string]: number };
  } {
    const stats = {
      totalErrors: errors.length,
      criticalCount: 0,
      warningCount: 0,
      byErrorCode: {} as { [code: string]: number },
    };

    for (const error of errors) {
      if (error.severity === 'CRITICAL') {
        stats.criticalCount++;
      } else if (error.severity === 'WARNING') {
        stats.warningCount++;
      }

      stats.byErrorCode[error.errorCode] = (stats.byErrorCode[error.errorCode] || 0) + 1;
    }

    return stats;
  }
}
