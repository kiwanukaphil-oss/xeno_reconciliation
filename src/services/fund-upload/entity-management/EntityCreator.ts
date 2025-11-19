import { prisma } from '../../../config/database';
import { logger } from '../../../config/logger';
import { NewEntitiesReport } from '../../../types/fundTransaction';

/**
 * Creates approved clients, accounts, and goals in the database
 */
export class EntityCreator {
  /**
   * Creates all approved entities from a new entities report
   */
  static async createApprovedEntities(
    report: NewEntitiesReport,
    _uploadBatchId: string
  ): Promise<{
    clientsCreated: number;
    accountsCreated: number;
    goalsCreated: number;
  }> {
    logger.info('Creating approved entities');

    let clientsCreated = 0;
    let accountsCreated = 0;
    let goalsCreated = 0;

    // Create clients first
    for (const clientInfo of report.clients) {
      try {
        await prisma.client.create({
          data: {
            clientName: clientInfo.clientName,
            status: 'ACTIVE',
          },
        });
        clientsCreated++;
        logger.info(`Created client: ${clientInfo.clientName}`);
      } catch (error: any) {
        // Skip if already exists (race condition)
        if (error.code === 'P2002') {
          logger.warn(`Client already exists: ${clientInfo.clientName}`);
        } else {
          throw error;
        }
      }
    }

    // Create accounts
    for (const accountInfo of report.accounts) {
      try {
        // Find the client
        const client = await prisma.client.findFirst({
          where: { clientName: accountInfo.clientName },
        });

        if (!client) {
          logger.error(`Client not found for account: ${accountInfo.accountNumber}`);
          continue;
        }

        await prisma.account.create({
          data: {
            clientId: client.id,
            accountNumber: accountInfo.accountNumber,
            accountType: accountInfo.accountType as any,
            accountCategory: accountInfo.accountCategory as any,
            sponsorCode: accountInfo.sponsorCode || null,
            status: 'ACTIVE',
            openedAt: new Date(),
          },
        });
        accountsCreated++;
        logger.info(`Created account: ${accountInfo.accountNumber}`);
      } catch (error: any) {
        if (error.code === 'P2002') {
          logger.warn(`Account already exists: ${accountInfo.accountNumber}`);
        } else {
          throw error;
        }
      }
    }

    // Create goals
    for (const goalInfo of report.goals) {
      try {
        // Find the account
        const account = await prisma.account.findUnique({
          where: { accountNumber: goalInfo.accountNumber },
        });

        if (!account) {
          logger.error(`Account not found for goal: ${goalInfo.goalNumber}`);
          continue;
        }

        await prisma.goal.create({
          data: {
            accountId: account.id,
            goalNumber: goalInfo.goalNumber,
            goalTitle: goalInfo.goalTitle,
            goalType: 'OTHER', // Default, can be updated later
            riskTolerance: 'MODERATE', // Default
            fundDistribution: goalInfo.fundDistribution,
            status: 'ACTIVE',
          },
        });
        goalsCreated++;
        logger.info(`Created goal: ${goalInfo.goalNumber}`);
      } catch (error: any) {
        if (error.code === 'P2002') {
          logger.warn(`Goal already exists: ${goalInfo.goalNumber}`);
        } else {
          throw error;
        }
      }
    }

    logger.info(
      `Entities created: ${clientsCreated} clients, ${accountsCreated} accounts, ${goalsCreated} goals`
    );

    return {
      clientsCreated,
      accountsCreated,
      goalsCreated,
    };
  }

  /**
   * Creates a single client
   */
  static async createClient(clientName: string): Promise<string> {
    const client = await prisma.client.create({
      data: {
        clientName,
        status: 'ACTIVE',
      },
    });

    return client.id;
  }

  /**
   * Creates a single account
   */
  static async createAccount(
    clientId: string,
    accountNumber: string,
    accountType: string,
    accountCategory: string
  ): Promise<string> {
    const account = await prisma.account.create({
      data: {
        clientId,
        accountNumber,
        accountType: accountType as any,
        accountCategory: accountCategory as any,
        status: 'ACTIVE',
        openedAt: new Date(),
      },
    });

    return account.id;
  }

  /**
   * Creates a single goal
   */
  static async createGoal(
    accountId: string,
    goalNumber: string,
    goalTitle: string,
    fundDistribution: Record<string, number>
  ): Promise<string> {
    const goal = await prisma.goal.create({
      data: {
        accountId,
        goalNumber,
        goalTitle,
        goalType: 'OTHER',
        riskTolerance: 'MODERATE',
        fundDistribution,
        status: 'ACTIVE',
      },
    });

    return goal.id;
  }
}
