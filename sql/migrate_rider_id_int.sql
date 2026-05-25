-- Prime Dashboard — Migrate rider_id from TEXT to INTEGER
-- Run ONCE against Supabase with:
--   psql "$DATABASE_URL" -f sql/migrate_rider_id_int.sql
-- Safe to re-run: the DO block checks if columns are already INT before altering.

-- ── Step 0: Audit — fail fast if any non-numeric IDs exist ───────────────────
DO $$
DECLARE
  bad_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO bad_count
  FROM rider_daily
  WHERE rider_id !~ '^\d+$';

  IF bad_count > 0 THEN
    RAISE EXCEPTION 'rider_daily has % non-numeric rider_id values — migration aborted', bad_count;
  END IF;

  SELECT COUNT(*) INTO bad_count
  FROM rider_day_shipments
  WHERE rider_id !~ '^\d+$';

  IF bad_count > 0 THEN
    RAISE EXCEPTION 'rider_day_shipments has % non-numeric rider_id values — migration aborted', bad_count;
  END IF;

  RAISE NOTICE 'Audit passed: all rider_id values are numeric.';
END $$;

-- ── Step 1: Drop indexes and PKs on rider_daily ───────────────────────────────
ALTER TABLE rider_daily DROP CONSTRAINT IF EXISTS rider_daily_pkey;
DROP INDEX IF EXISTS rider_daily_rider_idx;
DROP INDEX IF EXISTS rider_daily_hub_idx;
DROP INDEX IF EXISTS rider_daily_date_idx;

-- ── Step 2: Alter column type on rider_daily ──────────────────────────────────
DO $$
BEGIN
  IF (SELECT data_type FROM information_schema.columns
      WHERE table_name = 'rider_daily' AND column_name = 'rider_id') <> 'integer' THEN
    ALTER TABLE rider_daily
      ALTER COLUMN rider_id TYPE INTEGER USING rider_id::INTEGER;
    RAISE NOTICE 'rider_daily.rider_id converted to INTEGER.';
  ELSE
    RAISE NOTICE 'rider_daily.rider_id is already INTEGER, skipping.';
  END IF;
END $$;

-- ── Step 3: Restore PK and indexes on rider_daily ────────────────────────────
ALTER TABLE rider_daily ADD PRIMARY KEY (date, rider_id);
CREATE INDEX IF NOT EXISTS rider_daily_rider_idx ON rider_daily (rider_id, date DESC);
CREATE INDEX IF NOT EXISTS rider_daily_hub_idx   ON rider_daily (hub, date);
CREATE INDEX IF NOT EXISTS rider_daily_date_idx  ON rider_daily (date);

-- ── Step 4: Drop indexes and PK on rider_day_shipments ───────────────────────
ALTER TABLE rider_day_shipments DROP CONSTRAINT IF EXISTS rider_day_shipments_pkey;
DROP INDEX IF EXISTS rider_day_ship_date_hub_idx;
DROP INDEX IF EXISTS rider_day_ship_rider_idx;
DROP INDEX IF EXISTS rider_day_ship_date_idx;

-- ── Step 5: Alter column type on rider_day_shipments ─────────────────────────
DO $$
BEGIN
  IF (SELECT data_type FROM information_schema.columns
      WHERE table_name = 'rider_day_shipments' AND column_name = 'rider_id') <> 'integer' THEN
    ALTER TABLE rider_day_shipments
      ALTER COLUMN rider_id TYPE INTEGER USING rider_id::INTEGER;
    RAISE NOTICE 'rider_day_shipments.rider_id converted to INTEGER.';
  ELSE
    RAISE NOTICE 'rider_day_shipments.rider_id is already INTEGER, skipping.';
  END IF;
END $$;

-- ── Step 6: Restore PK and indexes on rider_day_shipments ────────────────────
ALTER TABLE rider_day_shipments ADD PRIMARY KEY (date, rider_id, hub);
CREATE INDEX IF NOT EXISTS rider_day_ship_date_hub_idx ON rider_day_shipments (date, hub);
CREATE INDEX IF NOT EXISTS rider_day_ship_rider_idx    ON rider_day_shipments (rider_id, date DESC);
CREATE INDEX IF NOT EXISTS rider_day_ship_date_idx     ON rider_day_shipments (date);

-- ── Step 7: Recreate classify_riders() with INTEGER rider_id ─────────────────
CREATE OR REPLACE FUNCTION classify_riders(
  p_window_days       INTEGER DEFAULT 30,
  p_new_rider_days    INTEGER DEFAULT 7,
  p_evening_threshold NUMERIC DEFAULT 80,
  p_cross_threshold   NUMERIC DEFAULT 70,
  p_regular_threshold NUMERIC DEFAULT 80
) RETURNS TABLE (
  rider_id              INTEGER,
  rider_name            TEXT,
  hub                   TEXT,
  city                  TEXT,
  zone                  TEXT,
  pod_name              TEXT,
  total_days            INTEGER,
  login_days            INTEGER,
  morning_login_days    INTEGER,
  evening_login_days    INTEGER,
  login_rate_pct        NUMERIC,
  evening_login_rate_pct NUMERIC,
  first_ever_login      DATE,
  active_since_days     INTEGER,
  login_behaviour_tag   TEXT,
  regularity_tag        TEXT
)
LANGUAGE SQL STABLE
AS $$
  WITH anchor AS (
    SELECT anchor_date FROM data_anchor WHERE id = 1
  ),
  win AS (
    SELECT
      anchor_date,
      (anchor_date - (p_window_days - 1) * INTERVAL '1 day')::DATE AS start_date
    FROM anchor
  ),
  daily AS (
    SELECT
      rd.rider_id,
      MAX(rd.rider_name)  AS rider_name,
      MAX(rd.hub)         AS hub,
      COUNT(*)::INTEGER   AS login_days,
      SUM(CASE WHEN rd.morning_runsheet_hour IS NOT NULL THEN 1 ELSE 0 END)::INTEGER AS morning_login_days,
      SUM(CASE WHEN rd.evening_runsheet_hour IS NOT NULL THEN 1 ELSE 0 END)::INTEGER AS evening_login_days
    FROM rider_daily rd, win
    WHERE rd.date BETWEEN win.start_date AND win.anchor_date
    GROUP BY rd.rider_id
  ),
  global_first AS (
    SELECT rider_id, MIN(date) AS first_ever_login
    FROM rider_daily
    GROUP BY rider_id
  )
  SELECT
    d.rider_id,
    d.rider_name,
    d.hub,
    hm.city,
    hm.zone,
    hm.pod_name,
    p_window_days AS total_days,
    d.login_days,
    d.morning_login_days,
    d.evening_login_days,
    ROUND(d.login_days * 100.0 / p_window_days, 1) AS login_rate_pct,
    ROUND(d.evening_login_days * 100.0 / NULLIF(d.login_days, 0), 1) AS evening_login_rate_pct,
    gf.first_ever_login,
    (win.anchor_date - gf.first_ever_login)::INTEGER AS active_since_days,
    CASE
      WHEN d.morning_login_days = 0
       AND ROUND(d.evening_login_days * 100.0 / NULLIF(d.login_days, 0), 1) >= p_evening_threshold
      THEN 'Evening Rider'
      WHEN d.morning_login_days > 0
       AND ROUND(d.evening_login_days * 100.0 / NULLIF(d.login_days, 0), 1) >= p_cross_threshold
      THEN 'Cross Utilised'
      ELSE 'Morning Rider'
    END AS login_behaviour_tag,
    CASE
      WHEN (win.anchor_date - gf.first_ever_login) <= p_new_rider_days
        THEN 'New Rider'
      WHEN ROUND(d.login_days * 100.0 / p_window_days, 1) >= p_regular_threshold
        THEN 'Regular'
      ELSE 'Irregular'
    END AS regularity_tag
  FROM daily d
  JOIN global_first gf ON gf.rider_id = d.rider_id
  CROSS JOIN win
  LEFT JOIN hub_mapping hm ON hm.hub = d.hub;
$$;

-- ── Step 8: Recreate v_current_classification view ───────────────────────────
CREATE OR REPLACE VIEW v_current_classification AS
SELECT c.*
FROM app_config cfg,
LATERAL classify_riders(
  cfg.analysis_window_days,
  cfg.new_rider_window_days,
  cfg.evening_rider_threshold,
  cfg.cross_util_evening_threshold,
  cfg.regular_threshold
) c
WHERE cfg.id = 1;

-- ── Done ─────────────────────────────────────────────────────────────────────
DO $$ BEGIN
  RAISE NOTICE 'Migration complete. rider_id is now INTEGER in rider_daily and rider_day_shipments.';
END $$;
