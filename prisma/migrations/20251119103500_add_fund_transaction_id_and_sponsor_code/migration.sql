-- AlterTable: Add sponsorCode to accounts (optional field)
ALTER TABLE "accounts" ADD COLUMN "sponsorCode" TEXT;

-- AlterTable: Add fundTransactionId to fund_transactions
-- Step 1: Add column as nullable first
ALTER TABLE "fund_transactions" ADD COLUMN "fundTransactionId" TEXT;

-- Step 2: Populate existing rows with UUIDs
UPDATE "fund_transactions"
SET "fundTransactionId" = gen_random_uuid()::TEXT
WHERE "fundTransactionId" IS NULL;

-- Step 3: Make column NOT NULL
ALTER TABLE "fund_transactions" ALTER COLUMN "fundTransactionId" SET NOT NULL;

-- Step 4: Add unique constraint
ALTER TABLE "fund_transactions" ADD CONSTRAINT "fund_transactions_fundTransactionId_key" UNIQUE ("fundTransactionId");

-- CreateIndex: Add index on fundTransactionId for faster lookups
CREATE INDEX "fund_transactions_fundTransactionId_idx" ON "fund_transactions"("fundTransactionId");

-- CreateIndex: Add index on sponsorCode for faster lookups
CREATE INDEX "accounts_sponsorCode_idx" ON "accounts"("sponsorCode");
