-- CreateIndex: Composite index for fund_transactions table
-- Optimizes JOIN queries for unit registry aggregation
CREATE INDEX IF NOT EXISTS "idx_ft_account_fund" ON "fund_transactions"("accountId", "fundId");

-- CreateIndex: Composite index for fund_prices table
-- Optimizes latest price lookups with ORDER BY priceDate DESC
CREATE INDEX IF NOT EXISTS "idx_fund_prices_fund_date" ON "fund_prices"("fundId", "priceDate" DESC);

-- CreateIndex: Additional composite index for common query patterns
-- Optimizes queries filtering by account and transaction date
CREATE INDEX IF NOT EXISTS "idx_ft_account_date" ON "fund_transactions"("accountId", "transactionDate" DESC);

-- CreateIndex: Composite index for client-account joins with filters
CREATE INDEX IF NOT EXISTS "idx_accounts_client_status" ON "accounts"("clientId", "status");

-- Note: These indexes significantly improve performance for:
-- 1. Unit registry aggregations (account -> fund_transactions -> funds)
-- 2. Latest price lookups (fund -> fund_prices ORDER BY date DESC)
-- 3. Transaction history queries (by account and date range)
-- 4. Client portfolio queries (client -> accounts with status filter)
