-- "As at" dates for Client Insights.
--
-- The calculations behind account_profile_aum, goal_holdings and goal_achievement move into three
-- functions that take a cut-off date. A row is built only from transactions dated on or before the
-- cut-off, valued at each fund's latest price on or before the price date; 12-month windows end at the
-- cut-off and ages are measured at the price date. Accounts and goals appear once they have a transaction.
-- The three materialized views become "latest" calls of these functions, so the screens' Latest figures and
-- any past date always use the same logic.
--
-- Snapshots for past dates are stored per date in the insights schema (kept out of public so Prisma
-- migrations never see or drop them) and tracked in insights.snapshot_dates.
--
-- Not historical (Ultima holds only current values): profile attributes (gender, district, channel, date of
-- birth), goal risk scores, target fund splits and goal targets. For past dates, Goal Achievement values each
-- goal from its own transactions at that date's prices (the ultima_* value/count columns then hold system
-- figures); Latest keeps Ultima's own values.

CREATE SCHEMA IF NOT EXISTS insights;

-- ---------------------------------------------------------------------------------------------
-- Row types (column-for-column the same as the existing views)
-- ---------------------------------------------------------------------------------------------

CREATE TYPE insights.account_row AS (
  account_id text,
  account_number text,
  account_type text,
  account_category text,
  client_id text,
  segment text,
  aum numeric(18,2),
  equity_value numeric(18,2),
  is_funded boolean,
  price_as_of date,
  data_as_of date,
  has_profile boolean,
  gender text,
  gender_with_estimate text,
  gender_basis text,
  female_probability double precision,
  date_of_birth date,
  age_years integer,
  age_band text,
  location_status text,
  district text,
  region text,
  country text,
  location_group text,
  district_raw text,
  signup_channel text,
  signup_platform text,
  phone_network text,
  contact_closed boolean,
  portal_enabled boolean,
  user_joined_at timestamp(3) without time zone,
  first_deposit_date date,
  last_deposit_date date,
  last_withdrawal_date date,
  last_activity_date date,
  deposit_count integer,
  deposit_total numeric(18,2),
  withdrawal_count integer,
  withdrawal_total numeric(18,2),
  deposits_12m integer,
  deposit_amount_12m numeric(18,2),
  deposit_months_12m integer,
  median_deposit numeric(18,2),
  avg_risk_score numeric,
  has_emergency_goal boolean,
  last_refreshed_at timestamp with time zone
);

CREATE TYPE insights.goal_holding_row AS (
  goal_id text,
  goal_number text,
  account_id text,
  account_number text,
  account_type text,
  account_category text,
  segment text,
  goal_type text,
  goal_category text,
  risk_score integer,
  sponsor_title text,
  sponsor_account_number text,
  xummf_value numeric(18,2),
  xubf_value numeric(18,2),
  xudef_value numeric(18,2),
  xuref_value numeric(18,2),
  target_xummf_pct numeric,
  target_xubf_pct numeric,
  target_xudef_pct numeric,
  target_xuref_pct numeric,
  total_value numeric,
  xummf_pct numeric,
  xubf_pct numeric,
  xudef_pct numeric,
  xuref_pct numeric,
  is_funded boolean,
  actual_equity_pct numeric,
  target_equity_pct numeric,
  equity_gap_pp numeric,
  drift_pp numeric,
  last_refreshed_at timestamp with time zone
);

CREATE TYPE insights.goal_achievement_row AS (
  goal_id text,
  goal_number text,
  account_id text,
  segment text,
  goal_category text,
  risk_score integer,
  snapshot_as_of date,
  data_as_of date,
  in_ultima boolean,
  goal_target numeric(18,2),
  ultima_value numeric(18,2),
  ultima_net_invested numeric(18,2),
  ultima_deposit_count integer,
  ultima_withdrawal_count integer,
  has_plausible_target boolean,
  peak_net_deposits numeric,
  first_reached_date date,
  net_flow_12m numeric,
  deposits_12m integer,
  deposit_amount_12m numeric,
  status text,
  progress numeric,
  target_band text,
  progress_band text,
  months_to_target numeric,
  pace_band text,
  last_refreshed_at timestamp with time zone
);

-- ---------------------------------------------------------------------------------------------
-- insights.accounts_as_of: one row per account (logic of account_profile_aum, with a cut-off)
-- ---------------------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION insights.accounts_as_of(p_as_of date, p_price_date date)
RETURNS SETOF insights.account_row
LANGUAGE sql STABLE
SET search_path = public
AS $$
WITH latest_prices AS (
  SELECT
    MAX(CASE WHEN f."fundCode" = 'XUMMF' THEN fp."midPrice" END) AS xummf,
    MAX(CASE WHEN f."fundCode" = 'XUBF'  THEN fp."midPrice" END) AS xubf,
    MAX(CASE WHEN f."fundCode" = 'XUDEF' THEN fp."midPrice" END) AS xudef,
    MAX(CASE WHEN f."fundCode" = 'XUREF' THEN fp."midPrice" END) AS xuref,
    MAX(fp."priceDate") AS price_as_of
  FROM fund_prices fp
  JOIN funds f ON f.id = fp."fundId"
  JOIN (SELECT "fundId", MAX("priceDate") AS max_date FROM fund_prices
        WHERE "priceDate" < p_price_date + 1 GROUP BY "fundId") l
    ON l."fundId" = fp."fundId" AND l.max_date = fp."priceDate"
),
data_cutoff AS (
  SELECT p_as_of AS data_as_of
),
balances AS (
  SELECT
    a.id AS account_id,
    a."accountNumber",
    a."accountType",
    a."accountCategory",
    c.id AS client_id,
    COALESCE(SUM(CASE WHEN f."fundCode" = 'XUMMF' THEN ft.units ELSE 0 END), 0) AS xummf_units,
    COALESCE(SUM(CASE WHEN f."fundCode" = 'XUBF'  THEN ft.units ELSE 0 END), 0) AS xubf_units,
    COALESCE(SUM(CASE WHEN f."fundCode" = 'XUDEF' THEN ft.units ELSE 0 END), 0) AS xudef_units,
    COALESCE(SUM(CASE WHEN f."fundCode" = 'XUREF' THEN ft.units ELSE 0 END), 0) AS xuref_units
  FROM accounts a
  JOIN clients c ON c.id = a."clientId"
  JOIN fund_transactions ft ON ft."accountId" = a.id AND ft."transactionDate" < p_as_of + 1
  JOIN funds f ON f.id = ft."fundId"
  GROUP BY a.id, a."accountNumber", a."accountType", a."accountCategory", c.id
),
goal_events AS (
  SELECT "accountId" AS account_id, "goalTransactionCode", MIN("transactionDate")::date AS tx_date, SUM(amount) AS net_amount
  FROM fund_transactions
  WHERE "transactionDate" < p_as_of + 1
  GROUP BY "accountId", "goalTransactionCode"
  HAVING ABS(SUM(amount)) >= 1
),
activity AS (
  SELECT
    e.account_id,
    MIN(e.tx_date) FILTER (WHERE e.net_amount > 0) AS first_deposit_date,
    MAX(e.tx_date) FILTER (WHERE e.net_amount > 0) AS last_deposit_date,
    MAX(e.tx_date) FILTER (WHERE e.net_amount < 0) AS last_withdrawal_date,
    COUNT(*) FILTER (WHERE e.net_amount > 0)::int AS deposit_count,
    COALESCE(SUM(e.net_amount) FILTER (WHERE e.net_amount > 0), 0) AS deposit_total,
    COUNT(*) FILTER (WHERE e.net_amount < 0)::int AS withdrawal_count,
    COALESCE(-SUM(e.net_amount) FILTER (WHERE e.net_amount < 0), 0) AS withdrawal_total,
    COUNT(*) FILTER (WHERE e.net_amount > 0 AND e.tx_date > c.data_as_of - INTERVAL '12 months')::int AS deposits_12m,
    COALESCE(SUM(e.net_amount) FILTER (WHERE e.net_amount > 0 AND e.tx_date > c.data_as_of - INTERVAL '12 months'), 0) AS deposit_amount_12m,
    COUNT(DISTINCT date_trunc('month', e.tx_date)) FILTER (WHERE e.net_amount > 0 AND e.tx_date > c.data_as_of - INTERVAL '12 months')::int AS deposit_months_12m,
    percentile_cont(0.5) WITHIN GROUP (ORDER BY e.net_amount) FILTER (WHERE e.net_amount > 0) AS median_deposit
  FROM goal_events e
  CROSS JOIN data_cutoff c
  GROUP BY e.account_id
),
goal_risk AS (
  SELECT "accountId" AS account_id, ROUND(AVG("riskScore"), 1) AS avg_risk_score,
         BOOL_OR("goalType" = 'EMERGENCY') AS has_emergency_goal
  FROM goals
  GROUP BY "accountId"
)
SELECT
  aub.account_id,
  aub."accountNumber" AS account_number,
  aub."accountType"::text AS account_type,
  aub."accountCategory"::text AS account_category,
  aub.client_id,
  CASE WHEN aub."accountType"::text IN ('PERSONAL', 'JOINT') THEN 'INDIVIDUAL' ELSE 'INSTITUTIONAL' END AS segment,

  -- Value at mid prices on the price date
  (aub.xummf_units * p.xummf + aub.xubf_units * p.xubf + aub.xudef_units * p.xudef + aub.xuref_units * p.xuref)::numeric(18, 2) AS aum,
  (aub.xudef_units * p.xudef + aub.xuref_units * p.xuref)::numeric(18, 2) AS equity_value,
  (aub.xummf_units * p.xummf + aub.xubf_units * p.xubf + aub.xudef_units * p.xudef + aub.xuref_units * p.xuref) >= 5000 AS is_funded,
  p.price_as_of,
  c.data_as_of,

  -- Profile (from Ultima, current values)
  ap.id IS NOT NULL AS has_profile,
  COALESCE(ap.gender::text, 'UNKNOWN') AS gender,
  -- Declared gender where given, otherwise the confident name-based estimate.
  -- "Rather not say" is respected: those accounts are never estimated.
  CASE WHEN ap.gender IS NOT NULL AND ap.gender <> 'UNKNOWN' THEN ap.gender::text
       ELSE COALESCE(ap."estimatedGender"::text, 'UNKNOWN') END AS gender_with_estimate,
  CASE WHEN ap.gender IS NOT NULL AND ap.gender <> 'UNKNOWN' THEN 'DECLARED'
       WHEN ap."estimatedGender" IS NOT NULL THEN 'ESTIMATED'
       ELSE 'UNKNOWN' END AS gender_basis,
  -- Probability the holder is female, for probability-weighted totals (declared = 1 or 0)
  CASE WHEN ap.gender = 'FEMALE' THEN 1.0::float8
       WHEN ap.gender = 'MALE' THEN 0.0::float8
       WHEN ap.gender = 'UNDISCLOSED' THEN NULL
       ELSE ap."estimatedFemaleProbability" END AS female_probability,
  ap."dateOfBirth" AS date_of_birth,
  CASE WHEN ap."dateOfBirth" IS NULL THEN NULL
       ELSE date_part('year', age(p.price_as_of, ap."dateOfBirth"))::int END AS age_years,
  CASE
    WHEN ap."dateOfBirth" IS NULL THEN 'UNKNOWN'
    WHEN date_part('year', age(p.price_as_of, ap."dateOfBirth")) < 18 THEN 'Under 18'
    WHEN date_part('year', age(p.price_as_of, ap."dateOfBirth")) <= 25 THEN '18-25'
    WHEN date_part('year', age(p.price_as_of, ap."dateOfBirth")) <= 35 THEN '26-35'
    WHEN date_part('year', age(p.price_as_of, ap."dateOfBirth")) <= 45 THEN '36-45'
    WHEN date_part('year', age(p.price_as_of, ap."dateOfBirth")) <= 55 THEN '46-55'
    WHEN date_part('year', age(p.price_as_of, ap."dateOfBirth")) <= 65 THEN '56-65'
    ELSE '65+'
  END AS age_band,
  COALESCE(ap."locationStatus"::text, 'MISSING') AS location_status,
  d.name AS district,
  d.region::text AS region,
  ap.country,
  CASE
    WHEN d.name IN ('Kampala', 'Wakiso') THEN 'Kampala & Wakiso'
    WHEN d.name IS NOT NULL THEN 'Rest of Uganda'
    WHEN ap."locationStatus" = 'ABROAD' THEN 'Abroad'
    ELSE 'UNKNOWN'
  END AS location_group,
  ap."districtRaw" AS district_raw,
  COALESCE(ap."signupChannel", 'UNKNOWN') AS signup_channel,
  ap."signupPlatform" AS signup_platform,
  COALESCE(ap."phoneNetwork"::text, 'UNKNOWN') AS phone_network,
  COALESCE(ap."contactClosed", false) AS contact_closed,
  ap."portalEnabled" AS portal_enabled,
  ap."userJoinedAt" AS user_joined_at,

  -- Saving activity up to the cut-off
  a.first_deposit_date,
  a.last_deposit_date,
  a.last_withdrawal_date,
  GREATEST(a.last_deposit_date, a.last_withdrawal_date) AS last_activity_date,
  COALESCE(a.deposit_count, 0) AS deposit_count,
  COALESCE(a.deposit_total, 0)::numeric(18, 2) AS deposit_total,
  COALESCE(a.withdrawal_count, 0) AS withdrawal_count,
  COALESCE(a.withdrawal_total, 0)::numeric(18, 2) AS withdrawal_total,
  COALESCE(a.deposits_12m, 0) AS deposits_12m,
  COALESCE(a.deposit_amount_12m, 0)::numeric(18, 2) AS deposit_amount_12m,
  COALESCE(a.deposit_months_12m, 0) AS deposit_months_12m,
  a.median_deposit::numeric(18, 2) AS median_deposit,

  -- Goals (current settings)
  gr.avg_risk_score,
  COALESCE(gr.has_emergency_goal, false) AS has_emergency_goal,

  NOW() AS last_refreshed_at
FROM balances aub
CROSS JOIN latest_prices p
CROSS JOIN data_cutoff c
LEFT JOIN account_profiles ap ON ap."accountId" = aub.account_id
LEFT JOIN districts d ON d.id = ap."districtId"
LEFT JOIN activity a ON a.account_id = aub.account_id
LEFT JOIN goal_risk gr ON gr.account_id = aub.account_id;
$$;

-- ---------------------------------------------------------------------------------------------
-- insights.goal_holdings_as_of: one row per goal (logic of goal_holdings, with a cut-off)
-- ---------------------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION insights.goal_holdings_as_of(p_as_of date, p_price_date date)
RETURNS SETOF insights.goal_holding_row
LANGUAGE sql STABLE
SET search_path = public
AS $$
WITH latest_prices AS (
  SELECT
    MAX(CASE WHEN f."fundCode" = 'XUMMF' THEN fp."midPrice" END) AS xummf,
    MAX(CASE WHEN f."fundCode" = 'XUBF'  THEN fp."midPrice" END) AS xubf,
    MAX(CASE WHEN f."fundCode" = 'XUDEF' THEN fp."midPrice" END) AS xudef,
    MAX(CASE WHEN f."fundCode" = 'XUREF' THEN fp."midPrice" END) AS xuref
  FROM fund_prices fp
  JOIN funds f ON f.id = fp."fundId"
  JOIN (SELECT "fundId", MAX("priceDate") AS max_date FROM fund_prices
        WHERE "priceDate" < p_price_date + 1 GROUP BY "fundId") l
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
  WHERE ft."transactionDate" < p_as_of + 1
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
    (gu.xummf_units * p.xummf)::numeric(18, 2) AS xummf_value,
    (gu.xubf_units  * p.xubf)::numeric(18, 2)  AS xubf_value,
    (gu.xudef_units * p.xudef)::numeric(18, 2) AS xudef_value,
    (gu.xuref_units * p.xuref)::numeric(18, 2) AS xuref_value,
    (g."targetFundSplit"->>'XUMMF')::numeric AS target_xummf_pct,
    (g."targetFundSplit"->>'XUBF')::numeric  AS target_xubf_pct,
    (g."targetFundSplit"->>'XUDEF')::numeric AS target_xudef_pct,
    (g."targetFundSplit"->>'XUREF')::numeric AS target_xuref_pct
  FROM goals g
  JOIN accounts a ON a.id = g."accountId"
  CROSS JOIN latest_prices p
  JOIN goal_units gu ON gu.goal_id = g.id
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
$$;

-- ---------------------------------------------------------------------------------------------
-- insights.goal_achievement_as_of: one row per goal (logic of goal_achievement, with a cut-off).
-- p_use_ultima_values = true (Latest): value and deposit counts from the Ultima Goal Stats snapshot.
-- p_use_ultima_values = false (past dates): value from the goal's own units at the price date and counts
-- from its transactions up to the cut-off. Targets always come from the latest Ultima snapshot.
-- ---------------------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION insights.goal_achievement_as_of(p_as_of date, p_price_date date, p_use_ultima_values boolean)
RETURNS SETOF insights.goal_achievement_row
LANGUAGE sql STABLE
SET search_path = public
AS $$
WITH latest AS (
  SELECT MAX("asOfDate") AS snapshot_as_of FROM ultima_goal_snapshots
),
snap AS (
  SELECT s.* FROM ultima_goal_snapshots s JOIN latest l ON s."asOfDate" = l.snapshot_as_of
),
data_cutoff AS (
  SELECT p_as_of AS data_as_of
),
prices AS (
  SELECT
    MAX(CASE WHEN f."fundCode" = 'XUMMF' THEN fp."midPrice" END) AS xummf,
    MAX(CASE WHEN f."fundCode" = 'XUBF'  THEN fp."midPrice" END) AS xubf,
    MAX(CASE WHEN f."fundCode" = 'XUDEF' THEN fp."midPrice" END) AS xudef,
    MAX(CASE WHEN f."fundCode" = 'XUREF' THEN fp."midPrice" END) AS xuref
  FROM fund_prices fp
  JOIN funds f ON f.id = fp."fundId"
  JOIN (SELECT "fundId", MAX("priceDate") AS max_date FROM fund_prices
        WHERE "priceDate" < p_price_date + 1 GROUP BY "fundId") l
    ON l."fundId" = fp."fundId" AND l.max_date = fp."priceDate"
),
goal_events AS (
  SELECT "goalId" AS goal_id, "goalTransactionCode" AS code, MIN("transactionDate")::date AS tx_date, SUM(amount) AS net
  FROM fund_transactions
  WHERE "transactionDate" < p_as_of + 1
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
         COALESCE(SUM(r.net) FILTER (WHERE r.net > 0 AND r.tx_date > c.data_as_of - INTERVAL '12 months'), 0) AS deposit_amount_12m,
         -- System-side equivalents of the Ultima snapshot figures, used for past dates
         COALESCE(SUM(r.net), 0) AS system_net_invested,
         COUNT(*) FILTER (WHERE r.net > 0)::int AS system_deposit_count,
         COUNT(*) FILTER (WHERE r.net < 0)::int AS system_withdrawal_count
  FROM running r
  CROSS JOIN data_cutoff c
  LEFT JOIN snap sn ON sn."goalId" = r.goal_id
  GROUP BY r.goal_id
),
goal_values AS (
  SELECT ft."goalId" AS goal_id,
         SUM(ft.units * CASE f."fundCode" WHEN 'XUMMF' THEN p.xummf WHEN 'XUBF' THEN p.xubf
                                          WHEN 'XUDEF' THEN p.xudef WHEN 'XUREF' THEN p.xuref END) AS system_value
  FROM fund_transactions ft
  JOIN funds f ON f.id = ft."fundId"
  CROSS JOIN prices p
  WHERE ft."transactionDate" < p_as_of + 1
  GROUP BY ft."goalId"
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
    CASE WHEN p_use_ultima_values THEN sn."currentValue"
         WHEN sn.id IS NOT NULL THEN gv.system_value::numeric(18, 2) END AS ultima_value,
    CASE WHEN p_use_ultima_values THEN sn."netInvested"
         WHEN sn.id IS NOT NULL THEN f.system_net_invested::numeric(18, 2) END AS ultima_net_invested,
    CASE WHEN p_use_ultima_values THEN sn."depositCount"
         WHEN sn.id IS NOT NULL THEN COALESCE(f.system_deposit_count, 0) END AS ultima_deposit_count,
    CASE WHEN p_use_ultima_values THEN sn."withdrawalCount"
         WHEN sn.id IS NOT NULL THEN COALESCE(f.system_withdrawal_count, 0) END AS ultima_withdrawal_count,
    COALESCE(sn."goalTarget" >= 10000 AND sn."goalTarget" < 10000000000, false) AS has_plausible_target,
    f.peak_net_deposits,
    f.first_reached_date,
    COALESCE(f.net_flow_12m, 0) AS net_flow_12m,
    COALESCE(f.deposits_12m, 0) AS deposits_12m,
    COALESCE(f.deposit_amount_12m, 0) AS deposit_amount_12m
  FROM goals g
  JOIN accounts a ON a.id = g."accountId"
  JOIN goal_values gv ON gv.goal_id = g.id
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
$$;

-- ---------------------------------------------------------------------------------------------
-- Latest views: same names and columns as before, now built from the functions
-- ---------------------------------------------------------------------------------------------

DROP MATERIALIZED VIEW IF EXISTS account_profile_aum;
CREATE MATERIALIZED VIEW account_profile_aum AS
SELECT * FROM insights.accounts_as_of(
  (SELECT MAX("transactionDate")::date FROM fund_transactions),
  (SELECT MAX("priceDate")::date FROM fund_prices)
);
CREATE UNIQUE INDEX account_profile_aum_account_id_key ON account_profile_aum (account_id);
CREATE INDEX account_profile_aum_segment_idx ON account_profile_aum (segment, is_funded);
CREATE INDEX account_profile_aum_aum_idx ON account_profile_aum (aum DESC);

DROP MATERIALIZED VIEW IF EXISTS goal_holdings;
CREATE MATERIALIZED VIEW goal_holdings AS
SELECT * FROM insights.goal_holdings_as_of(
  (SELECT MAX("transactionDate")::date FROM fund_transactions),
  (SELECT MAX("priceDate")::date FROM fund_prices)
);
CREATE UNIQUE INDEX goal_holdings_goal_id_key ON goal_holdings (goal_id);
CREATE INDEX goal_holdings_account_id_idx ON goal_holdings (account_id);
CREATE INDEX goal_holdings_segment_idx ON goal_holdings (segment, is_funded);
CREATE INDEX goal_holdings_sponsor_idx ON goal_holdings (sponsor_account_number);

DROP MATERIALIZED VIEW IF EXISTS goal_achievement;
CREATE MATERIALIZED VIEW goal_achievement AS
SELECT * FROM insights.goal_achievement_as_of(
  (SELECT MAX("transactionDate")::date FROM fund_transactions),
  (SELECT MAX("priceDate")::date FROM fund_prices),
  true
);
CREATE UNIQUE INDEX goal_achievement_goal_id_key ON goal_achievement (goal_id);
CREATE INDEX goal_achievement_account_id_idx ON goal_achievement (account_id);
CREATE INDEX goal_achievement_segment_status_idx ON goal_achievement (segment, status);

-- ---------------------------------------------------------------------------------------------
-- Snapshot storage and registry
-- ---------------------------------------------------------------------------------------------

-- One row per stored date. status: BUILDING -> READY, STALE when backdated data arrives, FAILED on error.
CREATE TABLE insights.snapshot_dates (
  as_of_date     date PRIMARY KEY,
  status         text NOT NULL CHECK (status IN ('BUILDING', 'READY', 'STALE', 'FAILED')),
  is_period_end  boolean NOT NULL DEFAULT false,
  requested_at   timestamptz NOT NULL DEFAULT now(),
  built_at       timestamptz,
  build_ms       integer,
  account_rows   integer,
  goal_rows      integer,
  price_as_of    date,
  stale_since    timestamptz,
  error          text
);

CREATE TABLE insights.account_snapshots (as_of_date date NOT NULL, LIKE insights.account_row);
ALTER TABLE insights.account_snapshots ADD PRIMARY KEY (as_of_date, account_id);
CREATE INDEX account_snapshots_segment_idx ON insights.account_snapshots (as_of_date, segment, is_funded);

CREATE TABLE insights.goal_holding_snapshots (as_of_date date NOT NULL, LIKE insights.goal_holding_row);
ALTER TABLE insights.goal_holding_snapshots ADD PRIMARY KEY (as_of_date, goal_id);
CREATE INDEX goal_holding_snapshots_account_idx ON insights.goal_holding_snapshots (as_of_date, account_id);
CREATE INDEX goal_holding_snapshots_segment_idx ON insights.goal_holding_snapshots (as_of_date, segment, is_funded);

CREATE TABLE insights.goal_achievement_snapshots (as_of_date date NOT NULL, LIKE insights.goal_achievement_row);
ALTER TABLE insights.goal_achievement_snapshots ADD PRIMARY KEY (as_of_date, goal_id);
CREATE INDEX goal_achievement_snapshots_account_idx ON insights.goal_achievement_snapshots (as_of_date, account_id);
CREATE INDEX goal_achievement_snapshots_segment_idx ON insights.goal_achievement_snapshots (as_of_date, segment, status);

-- Build (or rebuild) every snapshot table for one date and mark it READY. Prices are taken as at the
-- same date. Runs in the caller's transaction; on error the caller records FAILED.
CREATE OR REPLACE FUNCTION insights.build_snapshot(p_as_of date, p_is_period_end boolean DEFAULT false)
RETURNS insights.snapshot_dates
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  started timestamptz := clock_timestamp();
  n_accounts integer;
  n_goals integer;
  v_price_as_of date;
  result insights.snapshot_dates;
BEGIN
  DELETE FROM insights.account_snapshots WHERE as_of_date = p_as_of;
  DELETE FROM insights.goal_holding_snapshots WHERE as_of_date = p_as_of;
  DELETE FROM insights.goal_achievement_snapshots WHERE as_of_date = p_as_of;

  INSERT INTO insights.account_snapshots SELECT p_as_of, * FROM insights.accounts_as_of(p_as_of, p_as_of);
  GET DIAGNOSTICS n_accounts = ROW_COUNT;
  INSERT INTO insights.goal_holding_snapshots SELECT p_as_of, * FROM insights.goal_holdings_as_of(p_as_of, p_as_of);
  GET DIAGNOSTICS n_goals = ROW_COUNT;
  INSERT INTO insights.goal_achievement_snapshots SELECT p_as_of, * FROM insights.goal_achievement_as_of(p_as_of, p_as_of, false);

  SELECT MIN(price_as_of) INTO v_price_as_of FROM insights.account_snapshots WHERE as_of_date = p_as_of;

  INSERT INTO insights.snapshot_dates AS s (as_of_date, status, is_period_end, built_at, build_ms, account_rows, goal_rows, price_as_of)
  VALUES (p_as_of, 'READY', p_is_period_end, now(), (EXTRACT(EPOCH FROM clock_timestamp() - started) * 1000)::int, n_accounts, n_goals, v_price_as_of)
  ON CONFLICT (as_of_date) DO UPDATE SET
    status = 'READY',
    is_period_end = s.is_period_end OR EXCLUDED.is_period_end,
    built_at = EXCLUDED.built_at,
    build_ms = EXCLUDED.build_ms,
    account_rows = EXCLUDED.account_rows,
    goal_rows = EXCLUDED.goal_rows,
    price_as_of = EXCLUDED.price_as_of,
    stale_since = NULL,
    error = NULL
  RETURNING * INTO result;
  RETURN result;
END;
$$;
