-- Add transactionId and source columns to goal_transactions_view

-- Drop existing view
DROP MATERIALIZED VIEW IF EXISTS goal_transactions_view;

-- Recreate with transactionId and source
CREATE MATERIALIZED VIEW goal_transactions_view AS
SELECT
  ft."goalTransactionCode" AS "goalTransactionCode",
  ft."transactionDate" AS "transactionDate",

  -- Source tracking fields (use first value from group since they should be consistent)
  MIN(ft."transactionId") AS "transactionId",
  MIN(ft."source"::text) AS "source",

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

-- Recreate indexes
CREATE UNIQUE INDEX idx_goal_tx_view_code_unique ON goal_transactions_view("goalTransactionCode");
CREATE INDEX idx_goal_tx_view_date ON goal_transactions_view("transactionDate" DESC);
CREATE INDEX idx_goal_tx_view_client ON goal_transactions_view("clientId");
CREATE INDEX idx_goal_tx_view_account ON goal_transactions_view("accountId");
CREATE INDEX idx_goal_tx_view_goal ON goal_transactions_view("goalId");
CREATE INDEX idx_goal_tx_view_date_client ON goal_transactions_view("transactionDate" DESC, "clientId");
CREATE INDEX idx_goal_tx_view_date_account ON goal_transactions_view("transactionDate" DESC, "accountId");

-- New indexes for transactionId and source filtering
CREATE INDEX idx_goal_tx_view_txn_id ON goal_transactions_view("transactionId");
CREATE INDEX idx_goal_tx_view_source ON goal_transactions_view("source");

COMMENT ON MATERIALIZED VIEW goal_transactions_view IS
'Pre-aggregated view of goal transactions for fast queries. Includes transactionId and source for filtering. Refresh after successful upload batches using REFRESH MATERIALIZED VIEW CONCURRENTLY goal_transactions_view.';
