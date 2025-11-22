-- Create materialized view for goal transactions
-- This pre-aggregates fund transactions by goalTransactionCode for fast queries

CREATE MATERIALIZED VIEW goal_transactions_view AS
SELECT
  ft."goalTransactionCode" AS "goalTransactionCode",
  ft."transactionDate" AS "transactionDate",

  -- Client info
  c.id AS "clientId",
  c."clientName" AS "clientName",

  -- Account info
  a.id AS "accountId",
  a."accountNumber" AS "accountNumber",

  -- Goal info
  g.id AS "goalId",
  g."goalNumber" AS "goalNumber",
  g."goalTitle" AS "goalTitle",

  -- Aggregated amounts (NET of all transaction types for reconciliation)
  SUM(ft.amount) AS "totalAmount",
  SUM(ft.units) AS "totalUnits",

  -- Individual fund amounts
  SUM(ft.amount) FILTER (WHERE f."fundCode" = 'XUMMF') AS "XUMMF",
  SUM(ft.amount) FILTER (WHERE f."fundCode" = 'XUBF') AS "XUBF",
  SUM(ft.amount) FILTER (WHERE f."fundCode" = 'XUDEF') AS "XUDEF",
  SUM(ft.amount) FILTER (WHERE f."fundCode" = 'XUREF') AS "XUREF",

  -- Transaction counts by type (for analysis)
  COUNT(*) AS "fundTransactionCount",
  COUNT(*) FILTER (WHERE ft."transactionType" = 'DEPOSIT') AS "depositCount",
  COUNT(*) FILTER (WHERE ft."transactionType" = 'WITHDRAWAL') AS "withdrawalCount",

  -- List all transaction types present (for reference)
  STRING_AGG(DISTINCT ft."transactionType"::text, ',') AS "transactionTypes",

  -- Last updated timestamp for cache management
  MAX(ft."createdAt") AS "lastUpdated"

FROM fund_transactions ft
INNER JOIN clients c ON ft."clientId" = c.id
INNER JOIN accounts a ON ft."accountId" = a.id
INNER JOIN goals g ON ft."goalId" = g.id
INNER JOIN funds f ON ft."fundId" = f.id

GROUP BY
  ft."goalTransactionCode",
  ft."transactionDate",
  c.id,
  c."clientName",
  a.id,
  a."accountNumber",
  g.id,
  g."goalNumber",
  g."goalTitle"

WITH DATA;

-- Create indexes for optimal query performance
-- Index on goalTransactionCode for lookups (non-unique to allow multiple transactions per day)
CREATE INDEX idx_goal_tx_view_code ON goal_transactions_view("goalTransactionCode");

-- Index on transaction date for date range queries (biggest query = 1 year)
CREATE INDEX idx_goal_tx_view_date ON goal_transactions_view("transactionDate" DESC);

-- Index on client_id for client-specific queries
CREATE INDEX idx_goal_tx_view_client ON goal_transactions_view("clientId");

-- Index on account_id for account-specific queries
CREATE INDEX idx_goal_tx_view_account ON goal_transactions_view("accountId");

-- Index on goal_id for goal-specific queries
CREATE INDEX idx_goal_tx_view_goal ON goal_transactions_view("goalId");

-- Composite index for common filter combinations (date + client)
CREATE INDEX idx_goal_tx_view_date_client ON goal_transactions_view("transactionDate" DESC, "clientId");

-- Composite index for common filter combinations (date + account)
CREATE INDEX idx_goal_tx_view_date_account ON goal_transactions_view("transactionDate" DESC, "accountId");

-- Add a comment explaining the view
COMMENT ON MATERIALIZED VIEW goal_transactions_view IS
'Pre-aggregated view of goal transactions for fast queries. Refresh after successful upload batches using REFRESH MATERIALIZED VIEW CONCURRENTLY goal_transactions_view.';
