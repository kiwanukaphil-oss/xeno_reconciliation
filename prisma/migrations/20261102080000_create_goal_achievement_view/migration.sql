-- One row per goal: achievement status against the Ultima goal target.
-- Feeds the Goal Achievement page and the Impact Pack (Q3: customer outcomes).
--
-- Target and current value come from the latest Ultima Goal Stats snapshot. Whether a goal
-- EVER reached its target comes from the system's own transactions: the running total of net
-- deposits (goal transactions classified by net amount, as in account_profile_aum). A goal whose
-- net deposits reached the target but whose value is now below it was reached and then used,
-- e.g. school fees saved and paid. Cash deposited excludes investment growth, so "ever reached"
-- is conservative. Targets of UGX 10k to 10bn count as plausible; others are excluded from rates.
--
-- Note: transactions may end earlier than the Ultima snapshot date (uploads lag), so pace figures
-- (last 12 months of saving) and "reached" dates describe the period covered by the system.

DROP MATERIALIZED VIEW IF EXISTS goal_achievement;

CREATE MATERIALIZED VIEW goal_achievement AS
WITH latest AS (
  SELECT MAX("asOfDate") AS snapshot_as_of FROM ultima_goal_snapshots
),
snap AS (
  SELECT s.* FROM ultima_goal_snapshots s JOIN latest l ON s."asOfDate" = l.snapshot_as_of
),
data_cutoff AS (
  SELECT MAX("transactionDate")::date AS data_as_of FROM fund_transactions
),
goal_events AS (
  SELECT "goalId" AS goal_id, "goalTransactionCode" AS code, MIN("transactionDate")::date AS tx_date, SUM(amount) AS net
  FROM fund_transactions
  GROUP BY "goalId", "goalTransactionCode"
  HAVING ABS(SUM(amount)) >= 1
),
running AS (
  SELECT goal_id, tx_date, net,
         SUM(net) OVER (PARTITION BY goal_id ORDER BY tx_date, code ROWS UNBOUNDED PRECEDING) AS cumulative_net
  FROM goal_events
),
flows AS (
  SELECT r.goal_id,
         MAX(r.cumulative_net) AS peak_net_deposits,
         MIN(r.tx_date) FILTER (WHERE sn."goalTarget" > 0 AND r.cumulative_net >= sn."goalTarget") AS first_reached_date,
         COALESCE(SUM(r.net) FILTER (WHERE r.tx_date > c.data_as_of - INTERVAL '12 months'), 0) AS net_flow_12m,
         COUNT(*) FILTER (WHERE r.net > 0 AND r.tx_date > c.data_as_of - INTERVAL '12 months')::int AS deposits_12m,
         COALESCE(SUM(r.net) FILTER (WHERE r.net > 0 AND r.tx_date > c.data_as_of - INTERVAL '12 months'), 0) AS deposit_amount_12m
  FROM running r
  CROSS JOIN data_cutoff c
  LEFT JOIN snap sn ON sn."goalId" = r.goal_id
  GROUP BY r.goal_id
),
base AS (
  SELECT
    g.id AS goal_id,
    g."goalNumber" AS goal_number,
    g."accountId" AS account_id,
    CASE WHEN a."accountType"::text IN ('PERSONAL', 'JOINT') THEN 'INDIVIDUAL' ELSE 'INSTITUTIONAL' END AS segment,
    COALESCE(g."ultimaGoalName", 'Unknown') AS goal_category,
    g."riskScore" AS risk_score,
    l.snapshot_as_of,
    c.data_as_of,
    sn.id IS NOT NULL AS in_ultima,
    sn."goalTarget" AS goal_target,
    sn."currentValue" AS ultima_value,
    sn."netInvested" AS ultima_net_invested,
    sn."depositCount" AS ultima_deposit_count,
    sn."withdrawalCount" AS ultima_withdrawal_count,
    COALESCE(sn."goalTarget" >= 10000 AND sn."goalTarget" < 10000000000, false) AS has_plausible_target,
    f.peak_net_deposits,
    f.first_reached_date,
    COALESCE(f.net_flow_12m, 0) AS net_flow_12m,
    COALESCE(f.deposits_12m, 0) AS deposits_12m,
    COALESCE(f.deposit_amount_12m, 0) AS deposit_amount_12m
  FROM goals g
  JOIN accounts a ON a.id = g."accountId"
  CROSS JOIN latest l
  CROSS JOIN data_cutoff c
  LEFT JOIN snap sn ON sn."goalId" = g.id
  LEFT JOIN flows f ON f.goal_id = g.id
),
classified AS (
  SELECT b.*,
    CASE
      WHEN NOT b.in_ultima THEN 'NO_ULTIMA_DATA'
      WHEN b.goal_target IS NULL OR b.goal_target <= 0 THEN 'NO_TARGET'
      WHEN NOT b.has_plausible_target THEN 'TARGET_OUT_OF_RANGE'
      WHEN b.ultima_value >= b.goal_target THEN 'REACHED_HOLDING'
      WHEN b.peak_net_deposits >= b.goal_target THEN 'REACHED_USED'
      WHEN b.ultima_deposit_count = 0 AND b.ultima_value < 1000 AND COALESCE(b.peak_net_deposits, 0) <= 0 THEN 'NOT_STARTED'
      ELSE 'IN_PROGRESS'
    END AS status,
    CASE WHEN b.has_plausible_target THEN LEAST(GREATEST(b.ultima_value / b.goal_target, 0), 10) END AS progress
  FROM base b
)
SELECT
  c.*,
  CASE
    WHEN NOT c.has_plausible_target THEN NULL
    WHEN c.goal_target < 100000 THEN '1. Under 100k'
    WHEN c.goal_target < 1000000 THEN '2. 100k - 1m'
    WHEN c.goal_target < 10000000 THEN '3. 1m - 10m'
    ELSE '4. 10m and above'
  END AS target_band,
  CASE
    WHEN c.status <> 'IN_PROGRESS' THEN NULL
    WHEN c.progress >= 0.75 THEN '5. 75-99%'
    WHEN c.progress >= 0.5 THEN '4. 50-74%'
    WHEN c.progress >= 0.25 THEN '3. 25-49%'
    WHEN c.progress >= 0.1 THEN '2. 10-24%'
    ELSE '1. Under 10%'
  END AS progress_band,
  -- Months to target at the last 12 months' net saving rate (in-progress goals only)
  CASE WHEN c.status = 'IN_PROGRESS' AND c.net_flow_12m > 0
       THEN ROUND((c.goal_target - c.ultima_value) / (c.net_flow_12m / 12.0), 1) END AS months_to_target,
  CASE
    WHEN c.status <> 'IN_PROGRESS' THEN NULL
    WHEN c.net_flow_12m <= 0 THEN '5. Not currently saving'
    WHEN (c.goal_target - c.ultima_value) / (c.net_flow_12m / 12.0) <= 12 THEN '1. Within 1 year'
    WHEN (c.goal_target - c.ultima_value) / (c.net_flow_12m / 12.0) <= 36 THEN '2. 1-3 years'
    WHEN (c.goal_target - c.ultima_value) / (c.net_flow_12m / 12.0) <= 120 THEN '3. 3-10 years'
    ELSE '4. More than 10 years'
  END AS pace_band,
  NOW() AS last_refreshed_at
FROM classified c;

-- Unique index required for REFRESH MATERIALIZED VIEW CONCURRENTLY
CREATE UNIQUE INDEX goal_achievement_goal_id_key ON goal_achievement (goal_id);
CREATE INDEX goal_achievement_account_id_idx ON goal_achievement (account_id);
CREATE INDEX goal_achievement_segment_status_idx ON goal_achievement (segment, status);
