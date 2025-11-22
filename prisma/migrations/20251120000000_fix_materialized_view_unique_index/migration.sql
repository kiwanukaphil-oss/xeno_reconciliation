-- Fix materialized view to support REFRESH MATERIALIZED VIEW CONCURRENTLY
-- CONCURRENTLY requires a unique index, which the original migration was missing

-- Drop the old non-unique index on goalTransactionCode
DROP INDEX IF EXISTS idx_goal_tx_view_code;

-- Create a UNIQUE index on the combination of fields that makes each row unique
-- This enables REFRESH MATERIALIZED VIEW CONCURRENTLY to work correctly
CREATE UNIQUE INDEX idx_goal_tx_view_unique
ON goal_transactions_view("goalTransactionCode", "transactionDate", "clientId", "accountId", "goalId");

-- Recreate the date index for query performance (if it was dropped)
CREATE INDEX IF NOT EXISTS idx_goal_tx_view_date
ON goal_transactions_view("transactionDate" DESC);

-- Add a comment explaining the unique index requirement
COMMENT ON INDEX idx_goal_tx_view_unique IS
'Unique index required for REFRESH MATERIALIZED VIEW CONCURRENTLY. Each row is uniquely identified by the combination of goalTransactionCode, transactionDate, and entity IDs.';
