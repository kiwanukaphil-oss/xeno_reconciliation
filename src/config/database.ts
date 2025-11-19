import { PrismaClient } from '@prisma/client';
import { config } from './env';

// Create Prisma client instance
const prisma = new PrismaClient({
  log:
    config.nodeEnv === 'development'
      ? ['query', 'info', 'warn', 'error']
      : ['warn', 'error'],
});

// Handle shutdown gracefully
process.on('beforeExit', async () => {
  await prisma.$disconnect();
});

export { prisma };
