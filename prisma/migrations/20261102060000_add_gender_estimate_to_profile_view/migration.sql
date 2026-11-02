-- One row per account: AUM at latest prices, saving activity, and Ultima profile.
-- Rebuilt to add the name-based gender estimate (gender_with_estimate, gender_basis, female_probability).
-- Feeds Client Insights, Data Quality and the Impact & Inclusion data pack.
--
-- Activity is measured on goal transactions (all fund legs sharing a goalTransactionCode),
-- classified by their NET amount: > 0 is a deposit, < 0 a withdrawal, ~0 (fund switches /
-- rebalancing) is ignored. "12m" windows end at the latest transaction date in the system
-- (data_as_of), not today, so figures stay meaningful when uploads lag.
--
-- Depends on account_unit_balances: refresh that view first.

DROP MATERIALIZED VIEW IF EXISTS account_profile_aum;

CREATE MATERIALIZED VIEW account_profile_aum AS
WITH latest_prices AS (
  SELECT
    MAX(CASE WHEN f."fundCode" = 'XUMMF' THEN fp."midPrice" END) AS xummf,
    MAX(CASE WHEN f."fundCode" = 'XUBF'  THEN fp."midPrice" END) AS xubf,
    MAX(CASE WHEN f."fundCode" = 'XUDEF' THEN fp."midPrice" END) AS xudef,
    MAX(CASE WHEN f."fundCode" = 'XUREF' THEN fp."midPrice" END) AS xuref,
    MAX(fp."priceDate") AS price_as_of
  FROM fund_prices fp
  JOIN funds f ON f.id = fp."fundId"
  JOIN (SELECT "fundId", MAX("priceDate") AS max_date FROM fund_prices GROUP BY "fundId") l
    ON l."fundId" = fp."fundId" AND l.max_date = fp."priceDate"
),
data_cutoff AS (
  SELECT MAX("transactionDate")::date AS data_as_of FROM fund_transactions
),
goal_events AS (
  SELECT "accountId" AS account_id, "goalTransactionCode", MIN("transactionDate")::date AS tx_date, SUM(amount) AS net_amount
  FROM fund_transactions
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

  -- Value at latest mid prices
  (aub.xummf_units * p.xummf + aub.xubf_units * p.xubf + aub.xudef_units * p.xudef + aub.xuref_units * p.xuref)::numeric(18, 2) AS aum,
  (aub.xudef_units * p.xudef + aub.xuref_units * p.xuref)::numeric(18, 2) AS equity_value,
  (aub.xummf_units * p.xummf + aub.xubf_units * p.xubf + aub.xudef_units * p.xudef + aub.xuref_units * p.xuref) >= 5000 AS is_funded,
  p.price_as_of,
  c.data_as_of,

  -- Profile (from Ultima)
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

  -- Saving activity
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

  -- Goals
  gr.avg_risk_score,
  COALESCE(gr.has_emergency_goal, false) AS has_emergency_goal,

  NOW() AS last_refreshed_at
FROM account_unit_balances aub
CROSS JOIN latest_prices p
CROSS JOIN data_cutoff c
LEFT JOIN account_profiles ap ON ap."accountId" = aub.account_id
LEFT JOIN districts d ON d.id = ap."districtId"
LEFT JOIN activity a ON a.account_id = aub.account_id
LEFT JOIN goal_risk gr ON gr.account_id = aub.account_id;

-- Unique index required for REFRESH MATERIALIZED VIEW CONCURRENTLY
CREATE UNIQUE INDEX account_profile_aum_account_id_key ON account_profile_aum (account_id);
CREATE INDEX account_profile_aum_segment_idx ON account_profile_aum (segment, is_funded);
CREATE INDEX account_profile_aum_aum_idx ON account_profile_aum (aum DESC);
