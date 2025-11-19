import { logger } from '../../../config/logger';
import { config } from '../../../config/env';
import { DateUtils } from '../../../utils/dateUtils';
import { NumberUtils } from '../../../utils/numberUtils';
import { StringUtils } from '../../../utils/stringUtils';
import {
  ParsedFundTransaction,
  TransactionValidationError,
} from '../../../types/fundTransaction';

/**
 * Validates individual fund transactions
 */
export class FundTransactionValidator {
  /**
   * Validates a single fund transaction
   */
  static validate(transaction: ParsedFundTransaction): TransactionValidationError[] {
    const errors: TransactionValidationError[] = [];

    // Required field validation
    errors.push(...this.validateRequiredFields(transaction));

    // Date validation
    errors.push(...this.validateDates(transaction));

    // Amount validation
    errors.push(...this.validateAmounts(transaction));

    // Units validation
    errors.push(...this.validateUnits(transaction));

    // Price validation
    errors.push(...this.validatePrices(transaction));

    // Business rules validation
    errors.push(...this.validateBusinessRules(transaction));

    return errors;
  }

  /**
   * Validates required fields
   */
  private static validateRequiredFields(
    transaction: ParsedFundTransaction
  ): TransactionValidationError[] {
    const errors: TransactionValidationError[] = [];
    const rowNumber = transaction.rowNumber;

    if (StringUtils.isEmpty(transaction.fundTransactionId)) {
      errors.push({
        rowNumber,
        field: 'fundTransactionId',
        errorCode: 'REQUIRED_FUND_TRANSACTION_ID',
        message: 'Fund transaction ID is required',
        severity: 'CRITICAL',
        suggestedAction: 'Ensure the fundTransactionId field is not empty',
      });
    }

    if (!transaction.transactionDate) {
      errors.push({
        rowNumber,
        field: 'transactionDate',
        errorCode: 'REQUIRED_TRANSACTION_DATE',
        message: 'Transaction date is required',
        severity: 'CRITICAL',
        suggestedAction: 'Ensure the transactionDate field is not empty',
      });
    }

    if (StringUtils.isEmpty(transaction.clientName)) {
      errors.push({
        rowNumber,
        field: 'clientName',
        errorCode: 'REQUIRED_CLIENT_NAME',
        message: 'Client name is required',
        severity: 'CRITICAL',
        suggestedAction: 'Ensure the clientName field is not empty',
      });
    }

    if (StringUtils.isEmpty(transaction.fundCode)) {
      errors.push({
        rowNumber,
        field: 'fundCode',
        errorCode: 'REQUIRED_FUND_CODE',
        message: 'Fund code is required',
        severity: 'CRITICAL',
        suggestedAction: 'Ensure the fundCode field is not empty',
      });
    }

    if (transaction.amount === null || transaction.amount === undefined) {
      errors.push({
        rowNumber,
        field: 'amount',
        errorCode: 'REQUIRED_AMOUNT',
        message: 'Transaction amount is required',
        severity: 'CRITICAL',
        suggestedAction: 'Ensure the amount field is not empty',
      });
    }

    if (transaction.units === null || transaction.units === undefined) {
      errors.push({
        rowNumber,
        field: 'units',
        errorCode: 'REQUIRED_UNITS',
        message: 'Units are required',
        severity: 'CRITICAL',
        suggestedAction: 'Ensure the units field is not empty',
      });
    }

    if (StringUtils.isEmpty(transaction.accountNumber)) {
      errors.push({
        rowNumber,
        field: 'accountNumber',
        errorCode: 'REQUIRED_ACCOUNT_NUMBER',
        message: 'Account number is required',
        severity: 'CRITICAL',
        suggestedAction: 'Ensure the accountNumber field is not empty',
      });
    }

    if (StringUtils.isEmpty(transaction.goalNumber)) {
      errors.push({
        rowNumber,
        field: 'goalNumber',
        errorCode: 'REQUIRED_GOAL_NUMBER',
        message: 'Goal number is required',
        severity: 'CRITICAL',
        suggestedAction: 'Ensure the goalNumber field is not empty',
      });
    }

    return errors;
  }

  /**
   * Validates dates
   */
  private static validateDates(
    transaction: ParsedFundTransaction
  ): TransactionValidationError[] {
    const errors: TransactionValidationError[] = [];
    const rowNumber = transaction.rowNumber;

    if (transaction.transactionDate) {
      // Check if date is in the future (WARNING - reconciliation item)
      if (DateUtils.isFutureDate(transaction.transactionDate)) {
        errors.push({
          rowNumber,
          field: 'transactionDate',
          errorCode: 'DATE_NOT_FUTURE',
          message: 'Transaction date cannot be in the future',
          severity: 'WARNING',
          suggestedAction: 'Reconciliation item: Verify transaction date is today or in the past',
          value: DateUtils.formatDate(transaction.transactionDate),
        });
      }

      // Check if date is within acceptable range
      if (
        !DateUtils.isDateInRange(
          transaction.transactionDate,
          config.validation.dateRangeYearsPast,
          config.validation.dateRangeYearsFuture
        )
      ) {
        errors.push({
          rowNumber,
          field: 'transactionDate',
          errorCode: 'DATE_WITHIN_RANGE',
          message: `Transaction date is outside acceptable range (last ${config.validation.dateRangeYearsPast} years)`,
          severity: 'WARNING',
          suggestedAction: `Transaction date should be within the last ${config.validation.dateRangeYearsPast} years`,
          value: DateUtils.formatDate(transaction.transactionDate),
        });
      }
    }

    return errors;
  }

  /**
   * Validates amounts
   */
  private static validateAmounts(
    transaction: ParsedFundTransaction
  ): TransactionValidationError[] {
    const errors: TransactionValidationError[] = [];
    const rowNumber = transaction.rowNumber;

    if (transaction.amount !== null && transaction.amount !== undefined) {
      // Check if amount is positive (allow negative for withdrawals - reconciliation item)
      if (!NumberUtils.isPositive(transaction.amount) && transaction.transactionType !== 'WITHDRAWAL') {
        errors.push({
          rowNumber,
          field: 'amount',
          errorCode: 'AMOUNT_POSITIVE',
          message: 'Amount must be greater than zero for deposits',
          severity: 'WARNING',
          suggestedAction: 'Verify amount is positive for deposit transactions',
          value: transaction.amount,
        });
      }

      // Check if amount exceeds maximum (no minimum check as small amounts are common)
      if (Math.abs(transaction.amount) > config.validation.amountMax) {
        errors.push({
          rowNumber,
          field: 'amount',
          errorCode: 'AMOUNT_EXCEEDS_MAXIMUM',
          message: `Amount exceeds maximum limit of ${config.validation.amountMax.toLocaleString()}`,
          severity: 'WARNING',
          suggestedAction: `Verify amount does not exceed ${config.validation.amountMax.toLocaleString()}`,
          value: transaction.amount,
        });
      }
    }

    return errors;
  }

  /**
   * Validates units
   */
  private static validateUnits(
    transaction: ParsedFundTransaction
  ): TransactionValidationError[] {
    const errors: TransactionValidationError[] = [];
    const rowNumber = transaction.rowNumber;

    if (transaction.units !== null && transaction.units !== undefined) {
      // Check if units is positive (allow negative for withdrawals - reconciliation item)
      if (!NumberUtils.isPositive(transaction.units) && transaction.transactionType !== 'WITHDRAWAL') {
        errors.push({
          rowNumber,
          field: 'units',
          errorCode: 'UNITS_POSITIVE',
          message: 'Units must be greater than zero for deposits',
          severity: 'WARNING',
          suggestedAction: 'Verify units is positive for deposit transactions',
          value: transaction.units,
        });
      }

      // Validate unit trust calculation (for deposits) - WARNING for reconciliation
      if (
        transaction.transactionType === 'DEPOSIT' &&
        transaction.amount &&
        transaction.offerPrice
      ) {
        const expectedUnits = transaction.amount / transaction.offerPrice;
        if (
          !NumberUtils.areEqual(
            transaction.units,
            expectedUnits,
            config.validation.unitTrustTolerance
          )
        ) {
          errors.push({
            rowNumber,
            field: 'units',
            errorCode: 'UNITS_CALCULATION_VALID',
            message: `Unit calculation does not match expected formula. Expected: ${expectedUnits.toFixed(6)}, Got: ${transaction.units}`,
            severity: 'WARNING',
            suggestedAction: `Reconciliation item: units = amount / offerPrice (±${config.validation.unitTrustTolerance} tolerance)`,
            value: transaction.units,
          });
        }
      }

      // Validate unit trust calculation (for withdrawals) - WARNING for reconciliation
      if (
        transaction.transactionType === 'WITHDRAWAL' &&
        transaction.amount &&
        transaction.bidPrice
      ) {
        const expectedAmount = transaction.units * transaction.bidPrice;
        if (
          !NumberUtils.areEqual(
            transaction.amount,
            expectedAmount,
            config.validation.unitTrustTolerance
          )
        ) {
          errors.push({
            rowNumber,
            field: 'amount',
            errorCode: 'WITHDRAWAL_CALCULATION_VALID',
            message: `Withdrawal calculation does not match expected formula. Expected: ${expectedAmount.toFixed(2)}, Got: ${transaction.amount}`,
            severity: 'WARNING',
            suggestedAction: `Reconciliation item: amount = units × bidPrice (±${config.validation.unitTrustTolerance} tolerance)`,
            value: transaction.amount,
          });
        }
      }
    }

    return errors;
  }

  /**
   * Validates prices
   */
  private static validatePrices(
    transaction: ParsedFundTransaction
  ): TransactionValidationError[] {
    const errors: TransactionValidationError[] = [];
    const rowNumber = transaction.rowNumber;

    // Check if all prices are positive (WARNING - data quality check)
    if (
      transaction.bidPrice !== null &&
      transaction.bidPrice !== undefined &&
      !NumberUtils.isPositive(transaction.bidPrice)
    ) {
      errors.push({
        rowNumber,
        field: 'bidPrice',
        errorCode: 'PRICES_POSITIVE',
        message: 'Bid price must be greater than zero',
        severity: 'WARNING',
        suggestedAction: 'Verify bidPrice is a positive number',
        value: transaction.bidPrice,
      });
    }

    if (
      transaction.offerPrice !== null &&
      transaction.offerPrice !== undefined &&
      !NumberUtils.isPositive(transaction.offerPrice)
    ) {
      errors.push({
        rowNumber,
        field: 'offerPrice',
        errorCode: 'PRICES_POSITIVE',
        message: 'Offer price must be greater than zero',
        severity: 'WARNING',
        suggestedAction: 'Verify offerPrice is a positive number',
        value: transaction.offerPrice,
      });
    }

    if (
      transaction.midPrice !== null &&
      transaction.midPrice !== undefined &&
      !NumberUtils.isPositive(transaction.midPrice)
    ) {
      errors.push({
        rowNumber,
        field: 'midPrice',
        errorCode: 'PRICES_POSITIVE',
        message: 'Mid price must be greater than zero',
        severity: 'WARNING',
        suggestedAction: 'Verify midPrice is a positive number',
        value: transaction.midPrice,
      });
    }

    // Validate price relationship: bidPrice ≤ midPrice ≤ offerPrice (WARNING - reconciliation item)
    if (
      transaction.bidPrice &&
      transaction.midPrice &&
      transaction.offerPrice
    ) {
      if (
        transaction.bidPrice > transaction.midPrice ||
        transaction.midPrice > transaction.offerPrice
      ) {
        errors.push({
          rowNumber,
          field: 'prices',
          errorCode: 'PRICE_RELATIONSHIP_VALID',
          message: `Price relationship is invalid. Got: bid=${transaction.bidPrice}, mid=${transaction.midPrice}, offer=${transaction.offerPrice}`,
          severity: 'WARNING',
          suggestedAction: 'Reconciliation item: Verify bidPrice ≤ midPrice ≤ offerPrice',
          value: {
            bidPrice: transaction.bidPrice,
            midPrice: transaction.midPrice,
            offerPrice: transaction.offerPrice,
          },
        });
      }
    }

    return errors;
  }

  /**
   * Validates business rules
   */
  private static validateBusinessRules(
    transaction: ParsedFundTransaction
  ): TransactionValidationError[] {
    const errors: TransactionValidationError[] = [];
    const rowNumber = transaction.rowNumber;

    // Validate fund code (WARNING - reconciliation item for unexpected fund codes)
    const allowedFundCodes = ['XUMMF', 'XUBF', 'XUDEF', 'XUREF'];
    if (!allowedFundCodes.includes(transaction.fundCode)) {
      errors.push({
        rowNumber,
        field: 'fundCode',
        errorCode: 'FUND_CODE_VALID',
        message: `Unexpected fund code: ${transaction.fundCode}`,
        severity: 'WARNING',
        suggestedAction: 'Reconciliation item: Verify fund code is one of: XUMMF, XUBF, XUDEF, XUREF',
        value: transaction.fundCode,
      });
    }

    // Validate account number format (WARNING - reconciliation item for format variations)
    if (!StringUtils.isValidAccountNumber(transaction.accountNumber)) {
      errors.push({
        rowNumber,
        field: 'accountNumber',
        errorCode: 'ACCOUNT_NUMBER_FORMAT',
        message: `Account number format variation: ${transaction.accountNumber}`,
        severity: 'WARNING',
        suggestedAction: 'Reconciliation item: Expected format XXX-XXXXXXXXX',
        value: transaction.accountNumber,
      });
    }

    // Validate goal number format (WARNING - reconciliation item for format variations)
    if (!StringUtils.isValidGoalNumber(transaction.goalNumber)) {
      errors.push({
        rowNumber,
        field: 'goalNumber',
        errorCode: 'GOAL_NUMBER_FORMAT',
        message: `Goal number format variation: ${transaction.goalNumber}`,
        severity: 'WARNING',
        suggestedAction: 'Reconciliation item: Expected format: account number with letter suffix',
        value: transaction.goalNumber,
      });
    }

    // Validate transaction type
    const allowedTypes = ['DEPOSIT', 'WITHDRAWAL', 'REDEMPTION', 'SWITCH', 'DIVIDEND', 'TRANSFER'];
    if (!allowedTypes.includes(transaction.transactionType)) {
      errors.push({
        rowNumber,
        field: 'transactionType',
        errorCode: 'INVALID_TRANSACTION_TYPE',
        message: `Invalid transaction type: ${transaction.transactionType}`,
        severity: 'WARNING',
        suggestedAction: `Transaction type should be one of: ${allowedTypes.join(', ')}`,
        value: transaction.transactionType,
      });
    }

    return errors;
  }

  /**
   * Validates a batch of transactions
   */
  static validateBatch(transactions: ParsedFundTransaction[]): {
    validTransactions: ParsedFundTransaction[];
    invalidTransactions: Array<{
      transaction: ParsedFundTransaction;
      errors: TransactionValidationError[];
    }>;
    allErrors: TransactionValidationError[];
  } {
    logger.info(`Validating batch of ${transactions.length} transactions`);

    const validTransactions: ParsedFundTransaction[] = [];
    const invalidTransactions: Array<{
      transaction: ParsedFundTransaction;
      errors: TransactionValidationError[];
    }> = [];
    const allErrors: TransactionValidationError[] = [];

    // Track fundTransactionIds to detect duplicates within batch
    const seenIds = new Map<string, number>(); // Maps fundTransactionId to first row number

    for (const transaction of transactions) {
      const errors = this.validate(transaction);

      // Check for duplicate fundTransactionId within batch
      if (transaction.fundTransactionId) {
        const firstOccurrence = seenIds.get(transaction.fundTransactionId);
        if (firstOccurrence) {
          errors.push({
            rowNumber: transaction.rowNumber,
            field: 'fundTransactionId',
            errorCode: 'DUPLICATE_FUND_TRANSACTION_ID',
            message: `Duplicate fundTransactionId detected. First occurrence at row ${firstOccurrence}`,
            severity: 'WARNING',
            suggestedAction: 'Reconciliation item: Verify if duplicate fundTransactionIds are intentional in the source system or actual duplicates that should be removed.',
            value: transaction.fundTransactionId,
          });
        } else {
          seenIds.set(transaction.fundTransactionId, transaction.rowNumber);
        }
      }

      // Only consider critical errors as invalid
      const criticalErrors = errors.filter((e) => e.severity === 'CRITICAL');

      if (criticalErrors.length > 0) {
        invalidTransactions.push({ transaction, errors });
        allErrors.push(...errors);
      } else {
        validTransactions.push(transaction);
        // Still track warnings
        if (errors.length > 0) {
          allErrors.push(...errors);
        }
      }
    }

    logger.info(
      `Validation complete: ${validTransactions.length} valid, ${invalidTransactions.length} invalid`
    );

    return {
      validTransactions,
      invalidTransactions,
      allErrors,
    };
  }
}
