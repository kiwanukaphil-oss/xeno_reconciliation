-- One row per goal: value per fund at latest mid prices, actual vs target fund split, and drift.
-- Feeds risk & allocation reporting, suitability review and group scheme roll-ups.
--
-- Target split = goals."targetFundSplit" (Ultima's current allocation for the goal).
-- Percentages are only computed for goals with a positive total value.
-- drift_pp = largest absolute gap between actual and target share across the four funds.
-- Equity = XUDEF (domestic equity) + XUREF (regional equity).

DROP MATERIALIZED VIEW IF EXISTS goal_holdings;

CREATE MATERIALIZED VIEW goal_holdings AS
WITH latest_prices AS (
  SELECT
    MAX(CASE WHEN f."fundCode" = 'XUMMF' THEN fp."midPrice" END) AS xummf,
    MAX(CASE WHEN f."fundCode" = 'XUBF'  THEN fp."midPrice" END) AS xubf,
    MAX(CASE WHEN f."fundCode" = 'XUDEF' THEN fp."midPrice" END) AS xudef,
    MAX(CASE WHEN f."fundCode" = 'XUREF' THEN fp."midPrice" END) AS xuref
  FROM fund_prices fp
  JOIN funds f ON f.id = fp."fundId"
  JOIN (SELECT "fundId", MAX("priceDate") AS max_date FROM fund_prices GROUP BY "fundId") l
    ON l."fundId" = fp."fundId" AND l.max_date = fp."priceDate"
),
goal_units AS (
  SELECT
    ft."goalId" AS goal_id,
    COALESCE(SUM(ft.units) FILTER (WHERE f."fundCode" = 'XUMMF'), 0) AS xummf_units,
    COALESCE(SUM(ft.units) FILTER (WHERE f."fundCode" = 'XUBF'), 0)  AS xubf_units,
    COALESCE(SUM(ft.units) FILTER (WHERE f."fundCode" = 'XUDEF'), 0) AS xudef_units,
    COALESCE(SUM(ft.units) FILTER (WHERE f."fundCode" = 'XUREF'), 0) AS xuref_units
  FROM fund_transactions ft
  JOIN funds f ON f.id = ft."fundId"
  GROUP BY ft."goalId"
),
valued AS (
  SELECT
    g.id AS goal_id,
    g."goalNumber" AS goal_number,
    g."accountId" AS account_id,
    a."accountNumber" AS account_number,
    a."accountType"::text AS account_type,
    a."accountCategory"::text AS account_category,
    CASE WHEN a."accountType"::text IN ('PERSONAL', 'JOINT') THEN 'INDIVIDUAL' ELSE 'INSTITUTIONAL' END AS segment,
    g."goalType"::text AS goal_type,
    COALESCE(g."ultimaGoalName", 'Unknown') AS goal_category,
    g."riskScore" AS risk_score,
    g."sponsorTitle" AS sponsor_title,
    ap."sponsorAccountNumber" AS sponsor_account_number,
    (COALESCE(gu.xummf_units, 0) * p.xummf)::numeric(18, 2) AS xummf_value,
    (COALESCE(gu.xubf_units, 0)  * p.xubf)::numeric(18, 2)  AS xubf_value,
    (COALESCE(gu.xudef_units, 0) * p.xudef)::numeric(18, 2) AS xudef_value,
    (COALESCE(gu.xuref_units, 0) * p.xuref)::numeric(18, 2) AS xuref_value,
    (g."targetFundSplit"->>'XUMMF')::numeric AS target_xummf_pct,
    (g."targetFundSplit"->>'XUBF')::numeric  AS target_xubf_pct,
    (g."targetFundSplit"->>'XUDEF')::numeric AS target_xudef_pct,
    (g."targetFundSplit"->>'XUREF')::numeric AS target_xuref_pct
  FROM goals g
  JOIN accounts a ON a.id = g."accountId"
  CROSS JOIN latest_prices p
  LEFT JOIN goal_units gu ON gu.goal_id = g.id
  LEFT JOIN account_profiles ap ON ap."accountId" = a.id
),
with_totals AS (
  SELECT v.*, (xummf_value + xubf_value + xudef_value + xuref_value) AS total_value
  FROM valued v
),
with_shares AS (
  SELECT
    t.*,
    CASE WHEN total_value > 0 THEN ROUND(100 * xummf_value / total_value, 2) END AS xummf_pct,
    CASE WHEN total_value > 0 THEN ROUND(100 * xubf_value  / total_value, 2) END AS xubf_pct,
    CASE WHEN total_value > 0 THEN ROUND(100 * xudef_value / total_value, 2) END AS xudef_pct,
    CASE WHEN total_value > 0 THEN ROUND(100 * xuref_value / total_value, 2) END AS xuref_pct
  FROM with_totals t
)
SELECT
  s.*,
  s.total_value >= 5000 AS is_funded,
  s.xudef_pct + s.xuref_pct AS actual_equity_pct,
  s.target_xudef_pct + s.target_xuref_pct AS target_equity_pct,
  (s.xudef_pct + s.xuref_pct) - (s.target_xudef_pct + s.target_xuref_pct) AS equity_gap_pp,
  GREATEST(
    ABS(s.xummf_pct - s.target_xummf_pct),
    ABS(s.xubf_pct  - s.target_xubf_pct),
    ABS(s.xudef_pct - s.target_xudef_pct),
    ABS(s.xuref_pct - s.target_xuref_pct)
  ) AS drift_pp,
  NOW() AS last_refreshed_at
FROM with_shares s;

-- Unique index required for REFRESH MATERIALIZED VIEW CONCURRENTLY
CREATE UNIQUE INDEX goal_holdings_goal_id_key ON goal_holdings (goal_id);
CREATE INDEX goal_holdings_account_id_idx ON goal_holdings (account_id);
CREATE INDEX goal_holdings_segment_idx ON goal_holdings (segment, is_funded);
CREATE INDEX goal_holdings_sponsor_idx ON goal_holdings (sponsor_account_number);
