-- =====================================================================
-- MATERIALIZED VIEW: account_unit_balances
-- Purpose: Pre-aggregate 3.2M+ fund transactions into account-level balances
-- Performance: Reduces query time from 10+ seconds to under 1 second
-- =====================================================================

-- Drop existing view if exists (for redeployment)
DROP MATERIALIZED VIEW IF EXISTS account_unit_balances CASCADE;

-- Create materialized view with account-level aggregations
CREATE MATERIALIZED VIEW account_unit_balances AS
SELECT
  a.id as account_id,
  a."accountNumber",
  a."accountType",
  a."accountCategory",
  a.status as account_status,
  c.id as client_id,
  c."clientName",
  c.status as client_status,

  -- Last transaction date across all funds
  MAX(ft."transactionDate") as last_transaction_date,

  -- Unit balances per fund (sum of all transactions)
  COALESCE(SUM(CASE WHEN f."fundCode" = 'XUMMF' THEN ft.units ELSE 0 END), 0) as xummf_units,
  COALESCE(SUM(CASE WHEN f."fundCode" = 'XUBF' THEN ft.units ELSE 0 END), 0) as xubf_units,
  COALESCE(SUM(CASE WHEN f."fundCode" = 'XUDEF' THEN ft.units ELSE 0 END), 0) as xudef_units,
  COALESCE(SUM(CASE WHEN f."fundCode" = 'XUREF' THEN ft.units ELSE 0 END), 0) as xuref_units,

  -- Total units across all funds
  COALESCE(SUM(ft.units), 0) as total_units,

  -- Transaction counts per fund (for analytics)
  COUNT(CASE WHEN f."fundCode" = 'XUMMF' THEN 1 END) as xummf_transaction_count,
  COUNT(CASE WHEN f."fundCode" = 'XUBF' THEN 1 END) as xubf_transaction_count,
  COUNT(CASE WHEN f."fundCode" = 'XUDEF' THEN 1 END) as xudef_transaction_count,
  COUNT(CASE WHEN f."fundCode" = 'XUREF' THEN 1 END) as xuref_transaction_count,

  -- Metadata
  NOW() as last_refreshed_at

FROM accounts a
INNER JOIN clients c ON a."clientId" = c.id
LEFT JOIN fund_transactions ft ON ft."accountId" = a.id
LEFT JOIN funds f ON ft."fundId" = f.id
GROUP BY
  a.id,
  a."accountNumber",
  a."accountType",
  a."accountCategory",
  a.status,
  c.id,
  c."clientName",
  c.status;

-- =====================================================================
-- INDEXES: Optimize query performance on materialized view
-- =====================================================================

-- Unique index on account_id (primary key equivalent)
CREATE UNIQUE INDEX idx_account_balances_account_id
  ON account_unit_balances(account_id);

-- Index for client name searches (case-insensitive)
CREATE INDEX idx_account_balances_client_name
  ON account_unit_balances(LOWER("clientName"));

-- Index for account number searches (case-insensitive)
CREATE INDEX idx_account_balances_account_number
  ON account_unit_balances(LOWER("accountNumber"));

-- Index for filtering by total units (exclude zero balances)
CREATE INDEX idx_account_balances_total_units
  ON account_unit_balances(total_units)
  WHERE total_units > 0;

-- Index for sorting by total value (calculated at query time)
CREATE INDEX idx_account_balances_combined_units
  ON account_unit_balances(xummf_units, xubf_units, xudef_units, xuref_units);

-- Index for last transaction date sorting
CREATE INDEX idx_account_balances_last_transaction
  ON account_unit_balances(last_transaction_date DESC NULLS LAST);

-- Index for account status filtering
CREATE INDEX idx_account_balances_account_status
  ON account_unit_balances(account_status);

-- =====================================================================
-- REFRESH FUNCTION: Manually refresh the materialized view
-- =====================================================================

CREATE OR REPLACE FUNCTION refresh_account_unit_balances()
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  REFRESH MATERIALIZED VIEW CONCURRENTLY account_unit_balances;
  RAISE NOTICE 'Materialized view account_unit_balances refreshed successfully';
END;
$$;

-- Comment for documentation
COMMENT ON MATERIALIZED VIEW account_unit_balances IS
  'Pre-aggregated account unit balances for fast unit registry queries.
   Refresh using: SELECT refresh_account_unit_balances(); or REFRESH MATERIALIZED VIEW account_unit_balances;';

COMMENT ON FUNCTION refresh_account_unit_balances() IS
  'Refreshes the account_unit_balances materialized view.
   Usage: SELECT refresh_account_unit_balances();';

-- =====================================================================
-- INITIAL POPULATION: Populate the view with current data
-- =====================================================================

-- Note: The materialized view is already populated upon creation
-- Total rows should match the number of accounts
SELECT
  COUNT(*) as total_accounts,
  SUM(CASE WHEN total_units > 0 THEN 1 ELSE 0 END) as accounts_with_balances,
  SUM(CASE WHEN total_units = 0 THEN 1 ELSE 0 END) as accounts_with_zero_balance
FROM account_unit_balances;

-- Log the creation
DO $$
BEGIN
  RAISE NOTICE 'Materialized view account_unit_balances created and populated successfully';
  RAISE NOTICE 'Use: SELECT refresh_account_unit_balances(); to refresh data';
END $$;
