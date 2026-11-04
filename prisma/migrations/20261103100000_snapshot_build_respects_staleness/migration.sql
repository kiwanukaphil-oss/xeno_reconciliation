-- If backdated data arrives while a snapshot is being built (the registry row is marked stale after the
-- build started), the finished build is recorded as STALE rather than READY, so it is rebuilt again.

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
    status = CASE WHEN s.stale_since > started THEN 'STALE' ELSE 'READY' END,
    is_period_end = s.is_period_end OR EXCLUDED.is_period_end,
    built_at = EXCLUDED.built_at,
    build_ms = EXCLUDED.build_ms,
    account_rows = EXCLUDED.account_rows,
    goal_rows = EXCLUDED.goal_rows,
    price_as_of = EXCLUDED.price_as_of,
    stale_since = CASE WHEN s.stale_since > started THEN s.stale_since ELSE NULL END,
    error = NULL
  RETURNING * INTO result;
  RETURN result;
END;
$$;
