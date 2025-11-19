import { prisma } from '../../../config/database';
import { logger } from '../../../config/logger';
import {
  ParsedFundTransaction,
  NewClientInfo,
  NewAccountInfo,
  NewGoalInfo,
  NewEntitiesReport,
} from '../../../types/fundTransaction';
import { GoalTransactionCodeGenerator } from '../calculators/GoalTransactionCodeGenerator';

/**
 * Detects new clients, accounts, and goals in uploaded transactions
 */
export class EntityDetector {
  /**
   * Detects all new entities (clients, accounts, goals) from transactions
   */
  static async detectNewEntities(
    transactions: ParsedFundTransaction[]
  ): Promise<NewEntitiesReport> {
    logger.info('Detecting new entities in uploaded transactions');

    const [newClients, newAccounts, newGoals] = await Promise.all([
      this.detectNewClients(transactions),
      this.detectNewAccounts(transactions),
      this.detectNewGoals(transactions),
    ]);

    logger.info(
      `New entities detected: ${newClients.length} clients, ${newAccounts.length} accounts, ${newGoals.length} goals`
    );

    return {
      clients: newClients,
      accounts: newAccounts,
      goals: newGoals,
    };
  }

  /**
   * Detects new clients
   */
  private static async detectNewClients(
    transactions: ParsedFundTransaction[]
  ): Promise<NewClientInfo[]> {
    // Get unique client names from transactions
    const uniqueClientNames = new Set(transactions.map((t) => t.clientName));
    const clientNames = Array.from(uniqueClientNames);

    if (clientNames.length === 0) {
      return [];
    }

    // Query existing clients
    const existingClients = await prisma.client.findMany({
      where: {
        clientName: {
          in: clientNames,
        },
      },
      select: {
        clientName: true,
      },
    });

    const existingClientNames = new Set(existingClients.map((c) => c.clientName));

    // Find new clients
    const newClientNames = clientNames.filter((name) => !existingClientNames.has(name));

    // Build client info with transaction counts and totals
    const newClients: NewClientInfo[] = newClientNames.map((clientName) => {
      const clientTransactions = transactions.filter((t) => t.clientName === clientName);
      const totalAmount = clientTransactions.reduce((sum, t) => sum + t.amount, 0);

      return {
        clientName,
        transactionCount: clientTransactions.length,
        totalAmount,
      };
    });

    return newClients;
  }

  /**
   * Detects new accounts
   */
  private static async detectNewAccounts(
    transactions: ParsedFundTransaction[]
  ): Promise<NewAccountInfo[]> {
    // Get unique account numbers from transactions
    const accountMap = new Map<
      string,
      { accountType: string; accountCategory: string; sponsorCode?: string; clientName: string }
    >();

    for (const transaction of transactions) {
      if (!accountMap.has(transaction.accountNumber)) {
        accountMap.set(transaction.accountNumber, {
          accountType: transaction.accountType,
          accountCategory: transaction.accountCategory,
          sponsorCode: transaction.sponsorCode,
          clientName: transaction.clientName,
        });
      }
    }

    const accountNumbers = Array.from(accountMap.keys());

    if (accountNumbers.length === 0) {
      return [];
    }

    // Query existing accounts
    const existingAccounts = await prisma.account.findMany({
      where: {
        accountNumber: {
          in: accountNumbers,
        },
      },
      select: {
        accountNumber: true,
      },
    });

    const existingAccountNumbers = new Set(existingAccounts.map((a) => a.accountNumber));

    // Find new accounts
    const newAccountNumbers = accountNumbers.filter((num) => !existingAccountNumbers.has(num));

    // Build account info
    const newAccounts: NewAccountInfo[] = newAccountNumbers.map((accountNumber) => {
      const accountData = accountMap.get(accountNumber)!;
      const accountTransactions = transactions.filter(
        (t) => t.accountNumber === accountNumber
      );
      const totalAmount = accountTransactions.reduce((sum, t) => sum + t.amount, 0);

      return {
        accountNumber,
        accountType: accountData.accountType,
        accountCategory: accountData.accountCategory,
        sponsorCode: accountData.sponsorCode,
        clientName: accountData.clientName,
        transactionCount: accountTransactions.length,
        totalAmount,
      };
    });

    return newAccounts;
  }

  /**
   * Detects new goals
   */
  private static async detectNewGoals(
    transactions: ParsedFundTransaction[]
  ): Promise<NewGoalInfo[]> {
    // Get unique goal numbers from transactions
    const goalMap = new Map<
      string,
      { goalTitle: string; accountNumber: string; clientName: string }
    >();

    for (const transaction of transactions) {
      if (!goalMap.has(transaction.goalNumber)) {
        goalMap.set(transaction.goalNumber, {
          goalTitle: transaction.goalTitle,
          accountNumber: transaction.accountNumber,
          clientName: transaction.clientName,
        });
      }
    }

    const goalNumbers = Array.from(goalMap.keys());

    if (goalNumbers.length === 0) {
      return [];
    }

    // Query existing goals
    const existingGoals = await prisma.goal.findMany({
      where: {
        goalNumber: {
          in: goalNumbers,
        },
      },
      select: {
        goalNumber: true,
      },
    });

    const existingGoalNumbers = new Set(existingGoals.map((g) => g.goalNumber));

    // Find new goals
    const newGoalNumbers = goalNumbers.filter((num) => !existingGoalNumbers.has(num));

    // Build goal info with calculated fund distribution
    const newGoals: NewGoalInfo[] = newGoalNumbers.map((goalNumber) => {
      const goalData = goalMap.get(goalNumber)!;
      const goalTransactions = transactions.filter((t) => t.goalNumber === goalNumber);

      // Calculate fund distribution from transactions
      const fundDistribution = this.calculateFundDistribution(goalTransactions);
      const totalAmount = goalTransactions.reduce((sum, t) => sum + t.amount, 0);

      return {
        goalNumber,
        goalTitle: goalData.goalTitle,
        accountNumber: goalData.accountNumber,
        clientName: goalData.clientName,
        transactionCount: goalTransactions.length,
        totalAmount,
        fundDistribution,
      };
    });

    return newGoals;
  }

  /**
   * Calculates fund distribution percentages from transactions
   */
  private static calculateFundDistribution(
    transactions: ParsedFundTransaction[]
  ): Record<string, number> {
    // Group transactions by goalTransactionCode to get goal transactions
    const groups = GoalTransactionCodeGenerator.groupByCode(transactions);

    // Use the most common distribution pattern
    const distributionCounts = new Map<string, number>();

    for (const [, groupTransactions] of groups.entries()) {
      const totalAmount = groupTransactions.reduce((sum, t) => sum + t.amount, 0);

      if (totalAmount === 0) continue;

      // Calculate percentages for this goal transaction
      const distribution: Record<string, number> = {};
      for (const txn of groupTransactions) {
        const percentage = (txn.amount / totalAmount) * 100;
        distribution[txn.fundCode] = Math.round(percentage * 100) / 100; // Round to 2 decimals
      }

      // Create a signature for this distribution
      const signature = JSON.stringify(distribution);
      distributionCounts.set(signature, (distributionCounts.get(signature) || 0) + 1);
    }

    // Find the most common distribution pattern
    let mostCommon = '';
    let maxCount = 0;
    for (const [signature, count] of distributionCounts.entries()) {
      if (count > maxCount) {
        maxCount = count;
        mostCommon = signature;
      }
    }

    // Return the most common distribution, or equal distribution if none found
    if (mostCommon) {
      return JSON.parse(mostCommon);
    }

    // Default: equal distribution across all funds present
    const fundCodes = new Set(transactions.map((t) => t.fundCode));
    const equalPercentage = 100 / fundCodes.size;
    const distribution: Record<string, number> = {};
    for (const code of fundCodes) {
      distribution[code] = Math.round(equalPercentage * 100) / 100;
    }

    return distribution;
  }

  /**
   * Checks if there are any new entities
   */
  static hasNewEntities(report: NewEntitiesReport): boolean {
    return report.clients.length > 0 || report.accounts.length > 0 || report.goals.length > 0;
  }

  /**
   * Gets count of new entities
   */
  static getNewEntitiesCount(report: NewEntitiesReport): {
    clients: number;
    accounts: number;
    goals: number;
    total: number;
  } {
    return {
      clients: report.clients.length,
      accounts: report.accounts.length,
      goals: report.goals.length,
      total: report.clients.length + report.accounts.length + report.goals.length,
    };
  }
}
