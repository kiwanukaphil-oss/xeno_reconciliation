import { PrismaClient, ReconciliationStatus } from '@prisma/client';
import { logger } from '../../config/logger';
import { ParsedBankTransaction } from '../../types/bankTransaction';

const prisma = new PrismaClient();

// Local type definitions (previously from Prisma, now internal-only)
type VarianceType =
  | 'TOTAL_AMOUNT'
  | 'FUND_DISTRIBUTION'
  | 'FUND_AMOUNT'
  | 'DATE_DIFFERENCE'
  | 'MISSING_IN_BANK'
  | 'MISSING_IN_FUND';

type VarianceSeverity = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

/**
 * Matching result for a bank transaction
 */
export interface MatchResult {
  matched: boolean;
  matchScore: number; // 0-100
  goalTransactionCode: string | null;
  variances: DetectedVariance[];
  status: ReconciliationStatus;
  autoApproved: boolean;
}

/**
 * Detected variance between bank and fund transactions
 */
export interface DetectedVariance {
  type: VarianceType;
  severity: VarianceSeverity;
  description: string;
  expectedValue?: number;
  actualValue?: number;
  differenceAmount?: number;
  differencePercentage?: number;
  fundCode?: string;
  fundExpectedAmount?: number;
  fundActualAmount?: number;
  expectedDate?: Date;
  actualDate?: Date;
  dateDifferenceDays?: number;
  autoApproved: boolean;
  autoApprovalReason?: string;
}

/**
 * Tolerance configuration for matching and variance detection
 */
interface ToleranceConfig {
  amountPercentage: number; // 1% = 0.01
  amountFixed: number; // 1,000 UGX
  dateDays: number; // ±4 days
  fundDistributionPercentage: number; // 1% = 0.01
  severityThresholds: {
    low: number; // < 1,000
    medium: number; // 1,000 - 10,000
    high: number; // 10,000 - 50,000
    critical: number; // > 50,000
  };
}

const DEFAULT_TOLERANCE: ToleranceConfig = {
  amountPercentage: 0.01, // 1%
  amountFixed: 1000, // 1,000 UGX
  dateDays: 4,
  fundDistributionPercentage: 0.01, // 1%
  severityThresholds: {
    low: 1000,
    medium: 10000,
    high: 50000,
    critical: 50000,
  },
};

/**
 * Bank Reconciliation Matcher
 * Matches bank transactions with fund system transactions and detects variances
 */
export class BankReconciliationMatcher {
  private tolerance: ToleranceConfig;

  constructor(tolerance: ToleranceConfig = DEFAULT_TOLERANCE) {
    this.tolerance = tolerance;
  }

  /**
   * Matches a bank transaction with fund system transactions
   * Matching criteria: Goal Number + Transaction ID + Amount (within tolerance)
   */
  async matchTransaction(
    bankTransaction: ParsedBankTransaction
  ): Promise<MatchResult> {
    try {
      logger.info(
        `Matching bank transaction: Goal ${bankTransaction.goalNumber}, TxID ${bankTransaction.transactionId}, Amount ${bankTransaction.totalAmount}`
      );

      // Find potential matches using goal number and transaction ID
      const fundTransactions = await prisma.fundTransaction.findMany({
        where: {
          goal: {
            goalNumber: bankTransaction.goalNumber,
          },
          transactionId: bankTransaction.transactionId,
        },
        include: {
          goal: true,
          account: true,
          client: true,
          fund: true,
        },
      });

      if (fundTransactions.length === 0) {
        logger.warn(
          `No fund transactions found for Goal ${bankTransaction.goalNumber}, TxID ${bankTransaction.transactionId}`
        );
        return {
          matched: false,
          matchScore: 0,
          goalTransactionCode: null,
          variances: [
            {
              type: 'MISSING_IN_FUND',
              severity: 'CRITICAL',
              description: `No matching fund transaction found for goal ${bankTransaction.goalNumber} and transaction ID ${bankTransaction.transactionId}`,
              autoApproved: false,
            },
          ],
          status: ReconciliationStatus.MISSING_IN_FUND,
          autoApproved: false,
        };
      }

      // Group by goalTransactionCode (should all have the same code)
      const goalTransactionCode = fundTransactions[0].goalTransactionCode;

      // Calculate total amount from fund transactions
      const fundTotalAmount = fundTransactions.reduce(
        (sum, ft) => sum + Number(ft.amount),
        0
      );

      // Check if amounts match within tolerance
      const amountMatches = this.amountsMatch(
        bankTransaction.totalAmount,
        fundTotalAmount
      );

      if (!amountMatches) {
        logger.warn(
          `Amount mismatch: Bank ${bankTransaction.totalAmount} vs Fund ${fundTotalAmount}`
        );
        return {
          matched: false,
          matchScore: 50,
          goalTransactionCode,
          variances: [
            {
              type: 'TOTAL_AMOUNT',
              severity: this.calculateAmountSeverity(
                Math.abs(bankTransaction.totalAmount - fundTotalAmount)
              ),
              description: `Total amount mismatch`,
              expectedValue: fundTotalAmount,
              actualValue: bankTransaction.totalAmount,
              differenceAmount: bankTransaction.totalAmount - fundTotalAmount,
              differencePercentage:
                ((bankTransaction.totalAmount - fundTotalAmount) /
                  fundTotalAmount) *
                100,
              autoApproved: false,
            },
          ],
          status: ReconciliationStatus.VARIANCE_DETECTED,
          autoApproved: false,
        };
      }

      // Amounts match - now check for other variances
      const variances = await this.detectVariances(
        bankTransaction,
        fundTransactions,
        goalTransactionCode
      );

      // Determine status and auto-approval
      const { status, autoApproved } = this.determineStatus(variances);

      // Calculate match score
      const matchScore = this.calculateMatchScore(variances);

      logger.info(
        `Match result: Score ${matchScore}, Status ${status}, Variances ${variances.length}`
      );

      return {
        matched: true,
        matchScore,
        goalTransactionCode,
        variances,
        status,
        autoApproved,
      };
    } catch (error) {
      logger.error('Error matching bank transaction:', error);
      throw error;
    }
  }

  /**
   * Detects variances between bank and fund transactions
   */
  private async detectVariances(
    bankTransaction: ParsedBankTransaction,
    fundTransactions: any[],
    _goalTransactionCode: string
  ): Promise<DetectedVariance[]> {
    const variances: DetectedVariance[] = [];

    // Check date variance
    const fundDate = new Date(fundTransactions[0].transactionDate);
    const bankDate = bankTransaction.transactionDate;
    const dateDifference = Math.abs(
      Math.floor(
        (bankDate.getTime() - fundDate.getTime()) / (1000 * 60 * 60 * 24)
      )
    );

    if (dateDifference > 0 && dateDifference <= this.tolerance.dateDays) {
      variances.push({
        type: 'DATE_DIFFERENCE',
        severity: 'LOW',
        description: `Transaction date differs by ${dateDifference} day(s)`,
        expectedDate: fundDate,
        actualDate: bankDate,
        dateDifferenceDays: dateDifference,
        autoApproved: true,
        autoApprovalReason: `Date variance within acceptable tolerance (${this.tolerance.dateDays} days)`,
      });
    } else if (dateDifference > this.tolerance.dateDays) {
      variances.push({
        type: 'DATE_DIFFERENCE',
        severity: 'MEDIUM',
        description: `Transaction date differs by ${dateDifference} day(s) - exceeds tolerance`,
        expectedDate: fundDate,
        actualDate: bankDate,
        dateDifferenceDays: dateDifference,
        autoApproved: false,
      });
    }

    // Check fund distribution variances
    const fundAmounts: { [key: string]: number } = {};

    for (const ft of fundTransactions) {
      const fundCode = ft.fund.fundCode;
      fundAmounts[fundCode] = Number(ft.amount);
    }

    // Compare each fund
    const fundCodes = ['XUMMF', 'XUBF', 'XUDEF', 'XUREF'];
    for (const fundCode of fundCodes) {
      // Get bank amount from flat properties
      const bankAmountKey = `${fundCode.toLowerCase()}Amount` as keyof typeof bankTransaction;
      const bankAmount = bankTransaction[bankAmountKey] as number || 0;
      const fundAmount = fundAmounts[fundCode] || 0;

      const difference = Math.abs(bankAmount - fundAmount);
      const percentageDiff = fundAmount !== 0 ? difference / Math.abs(fundAmount) : 0;

      if (percentageDiff > this.tolerance.fundDistributionPercentage) {
        const severity = this.calculateAmountSeverity(difference);
        variances.push({
          type: 'FUND_AMOUNT',
          severity,
          description: `${fundCode} amount variance`,
          fundCode,
          fundExpectedAmount: fundAmount,
          fundActualAmount: bankAmount,
          differenceAmount: bankAmount - fundAmount,
          differencePercentage: percentageDiff * 100,
          autoApproved:
            severity === 'LOW' &&
            percentageDiff <= this.tolerance.fundDistributionPercentage * 2,
          autoApprovalReason:
            severity === 'LOW'
              ? 'Small variance within acceptable tolerance'
              : undefined,
        });
      }
    }

    return variances;
  }

  /**
   * Checks if two amounts match within tolerance
   * Tolerance: ±1% OR ±1,000 UGX (whichever is larger)
   */
  private amountsMatch(amount1: number, amount2: number): boolean {
    const difference = Math.abs(amount1 - amount2);
    const percentageTolerance = Math.abs(amount2) * this.tolerance.amountPercentage;
    const tolerance = Math.max(percentageTolerance, this.tolerance.amountFixed);

    return difference <= tolerance;
  }

  /**
   * Calculates variance severity based on amount
   */
  private calculateAmountSeverity(difference: number): VarianceSeverity {
    const absDiff = Math.abs(difference);

    if (absDiff < this.tolerance.severityThresholds.low) {
      return 'LOW';
    } else if (absDiff < this.tolerance.severityThresholds.medium) {
      return 'MEDIUM';
    } else if (absDiff < this.tolerance.severityThresholds.high) {
      return 'HIGH';
    } else {
      return 'CRITICAL';
    }
  }

  /**
   * Determines reconciliation status and auto-approval based on variances
   */
  private determineStatus(variances: DetectedVariance[]): {
    status: ReconciliationStatus;
    autoApproved: boolean;
  } {
    if (variances.length === 0) {
      return {
        status: ReconciliationStatus.MATCHED,
        autoApproved: true,
      };
    }

    // Check for critical or high severity variances
    const hasCritical = variances.some(
      (v) =>
        v.severity === 'CRITICAL' ||
        v.severity === 'HIGH'
    );

    if (hasCritical) {
      return {
        status: ReconciliationStatus.MANUAL_REVIEW,
        autoApproved: false,
      };
    }

    // All variances are low or medium severity
    // Auto-approve if all variances are marked as auto-approvable
    const allAutoApprovable = variances.every((v) => v.autoApproved);

    return {
      status: allAutoApprovable
        ? ReconciliationStatus.AUTO_APPROVED
        : ReconciliationStatus.MANUAL_REVIEW,
      autoApproved: allAutoApprovable,
    };
  }

  /**
   * Calculates match score (0-100)
   */
  private calculateMatchScore(variances: DetectedVariance[]): number {
    if (variances.length === 0) return 100;

    let score = 100;

    for (const variance of variances) {
      switch (variance.severity) {
        case 'LOW':
          score -= 5;
          break;
        case 'MEDIUM':
          score -= 15;
          break;
        case 'HIGH':
          score -= 30;
          break;
        case 'CRITICAL':
          score -= 50;
          break;
      }
    }

    return Math.max(0, score);
  }

  /**
   * Find fund transactions missing in bank upload
   */
  async findMissingInBank(
    uploadDateRange: { from: Date; to: Date }
  ): Promise<any[]> {
    // TODO: Find fund transactions in date range that don't have matching bank transactions
    // This requires checking against the bank_goal_transactions table
    // For now, return empty array - will implement in BankReconciliationService
    void uploadDateRange; // Acknowledge parameter for future implementation
    return [];
  }
}
