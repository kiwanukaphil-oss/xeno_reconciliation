-- Ultima target fund split per goal (intended allocation, used for drift reporting)
-- AlterTable
ALTER TABLE "goals" ADD COLUMN     "targetFundSplit" JSONB;

