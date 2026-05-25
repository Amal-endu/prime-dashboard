-- Prime Dashboard — Postgres schema
-- Target: Supabase free tier (Postgres 15+, 500MB limit)
-- Apply with: psql "$DATABASE_URL" -f sql/schema.sql
-- Idempotent: safe to re-run.

-- ============================================================================
-- Extensions
-- ============================================================================
CREATE EXTENSION IF NOT EXISTS pgcrypto;   -- gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS citext;     -- case-insensitive text for emails

-- ============================================================================
-- Schema layout
-- ----------------------------------------------------------------------------
-- All app tables live in the default `public` schema so the Supabase REST/
-- realtime layers can see them. Auth tables remain in `auth` (Supabase
-- managed). We mirror Supabase auth.users into public.app_users to attach
-- role + metadata without touching the protected auth schema.
-- ============================================================================

-- ============================================================================
-- Reference data (loaded once at ingest from CSVs)
-- ============================================================================

CREATE TABLE IF NOT EXISTS hub_mapping (
  hub        TEXT PRIMARY KEY,
  pod_name   TEXT,
  zone       TEXT,
  city       TEXT NOT NULL
);
-- Index for the city → hubs lookup used by the matrix and demand routes.
CREATE INDEX IF NOT EXISTS hub_mapping_city_idx ON hub_mapping (city);

CREATE TABLE IF NOT EXISTS cpo (
  city       TEXT PRIMARY KEY,
  base_pay   NUMERIC(8,2) NOT NULL,
  sdd_pay    NUMERIC(8,2) NOT NULL,
  total_pay  NUMERIC(8,2) NOT NULL
);

CREATE TABLE IF NOT EXISTS prime_clients (
  client_name TEXT PRIMARY KEY
);

-- ============================================================================
-- Raw daily rider rollup (existing, from raw_data.csv)
-- ----------------------------------------------------------------------------
-- This is the source of truth for login behaviour. NOT an aggregate of
-- sdd_awbs — it includes NDD orders that don't appear in the AWB feed.
-- Kept per-rider per-day forever (small: ~600KB for a year).
-- ============================================================================

CREATE TABLE IF NOT EXISTS rider_daily (
  date                   DATE    NOT NULL,
  rider_id               INTEGER NOT NULL,
  hub                    TEXT    NOT NULL,
  rider_name             TEXT,
  morning_runsheet_hour  SMALLINT,
  evening_runsheet_hour  SMALLINT,
  attempt_morning        INTEGER,
  attempt_evening        INTEGER,
  attempted_total        INTEGER,
  PRIMARY KEY (date, rider_id)
);
CREATE INDEX IF NOT EXISTS rider_daily_rider_idx ON rider_daily (rider_id, date DESC);
CREATE INDEX IF NOT EXISTS rider_daily_hub_idx   ON rider_daily (hub, date);
CREATE INDEX IF NOT EXISTS rider_daily_date_idx  ON rider_daily (date);

-- ============================================================================
-- Pre-aggregated shipment metrics (NEW)
-- ----------------------------------------------------------------------------
-- Replaces the 14-copy inline mr3_src CTE that scanned sdd_awbs at query
-- time. The 3MR cutoff hour is applied ONCE during ingest; queries just SUM.
--
-- _3mr   = AWBs where received_at_hub_time hour >= mr3CutoffHour (default 15)
-- _ovr   = all AWBs with ofd_time IS NOT NULL (no time-of-day filter)
--
-- Why both: the Daily Perf "3MR vs Overall" toggle needs both numbers; the
-- Demand tab needs Overall; Delivery/Profile need 3MR only.
--
-- Why per-(rider,hub) instead of per-rider: a rider can technically be in
-- two hubs on the same day if reassigned mid-shift. Preserve that.
-- ============================================================================

CREATE TABLE IF NOT EXISTS rider_day_shipments (
  date                  DATE    NOT NULL,
  rider_id              INTEGER NOT NULL,
  hub                   TEXT    NOT NULL,
  assigned_3mr          INTEGER NOT NULL DEFAULT 0,
  attempted_3mr         INTEGER NOT NULL DEFAULT 0,
  delivered_3mr         INTEGER NOT NULL DEFAULT 0,
  breach_count_3mr      INTEGER NOT NULL DEFAULT 0,
  assigned_overall      INTEGER NOT NULL DEFAULT 0,
  attempted_overall     INTEGER NOT NULL DEFAULT 0,
  delivered_overall     INTEGER NOT NULL DEFAULT 0,
  breach_count_overall  INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (date, rider_id, hub)
);
-- Hub-level and city-level rollups read by date range; this is the workhorse index.
CREATE INDEX IF NOT EXISTS rider_day_ship_date_hub_idx ON rider_day_shipments (date, hub);
CREATE INDEX IF NOT EXISTS rider_day_ship_rider_idx    ON rider_day_shipments (rider_id, date DESC);
CREATE INDEX IF NOT EXISTS rider_day_ship_date_idx     ON rider_day_shipments (date);

-- ============================================================================
-- Pre-aggregated client metrics (NEW)
-- ----------------------------------------------------------------------------
-- For the Demand "Client" sub-view. One row per (date, client). is_prime
-- denormalised so we don't JOIN prime_clients on every query.
-- ============================================================================

CREATE TABLE IF NOT EXISTS client_day_shipments (
  date                  DATE    NOT NULL,
  client_name           TEXT    NOT NULL,
  is_prime              BOOLEAN NOT NULL DEFAULT FALSE,
  awbs_3mr              INTEGER NOT NULL DEFAULT 0,
  delivered_3mr         INTEGER NOT NULL DEFAULT 0,
  awbs_overall          INTEGER NOT NULL DEFAULT 0,
  delivered_overall     INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (date, client_name)
);
CREATE INDEX IF NOT EXISTS client_day_ship_date_idx ON client_day_shipments (date);

-- ============================================================================
-- Pre-rolled L8D summary tables (NEW)
-- ----------------------------------------------------------------------------
-- The dashboard's two most-used views are "D-1" (latest data day) and "L8D"
-- (last 8 days trend). Rather than aggregate on every page load, these
-- tables hold the answer.
--
-- Refresh policy: TRUNCATE + INSERT at the END of every ingest, scoped to
-- the last 8 days. Cheap (~5000 rider-days × 8 = 40k rows). Always reflects
-- the latest anchor.
--
-- Grain: hub-day. Overall and city aggregations are computed at read time
-- by SUM-ing across hubs — fast enough that storing them separately is not
-- worth the duplication.
--
-- Note: client_day_shipments above already provides the per-client per-day
-- grain. No separate L8D table for clients — we just filter by date.
-- ============================================================================

CREATE TABLE IF NOT EXISTS hub_day_l8d (
  date                  DATE    NOT NULL,
  hub                   TEXT    NOT NULL,
  city                  TEXT    NOT NULL,       -- denormalised from hub_mapping for fast filtering
  zone                  TEXT,
  riders_active         INTEGER NOT NULL DEFAULT 0,
  assigned_3mr          INTEGER NOT NULL DEFAULT 0,
  attempted_3mr         INTEGER NOT NULL DEFAULT 0,
  delivered_3mr         INTEGER NOT NULL DEFAULT 0,
  breach_count_3mr      INTEGER NOT NULL DEFAULT 0,
  assigned_overall      INTEGER NOT NULL DEFAULT 0,
  attempted_overall     INTEGER NOT NULL DEFAULT 0,
  delivered_overall     INTEGER NOT NULL DEFAULT 0,
  breach_count_overall  INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (date, hub)
);
CREATE INDEX IF NOT EXISTS hub_day_l8d_city_idx ON hub_day_l8d (city, date);
CREATE INDEX IF NOT EXISTS hub_day_l8d_date_idx ON hub_day_l8d (date);

-- ============================================================================
-- Data freshness anchor
-- ----------------------------------------------------------------------------
-- Replaces the v_max_date DuckDB view. Holds BOTH source anchors so the API
-- can detect drift (the C1 correctness bug in the review). Queries should
-- use anchor_date (LEAST of the two) — not the max — to avoid silent
-- classification drift when one source leads the other.
-- ============================================================================

CREATE TABLE IF NOT EXISTS data_anchor (
  id                INT  PRIMARY KEY DEFAULT 1 CHECK (id = 1),  -- singleton
  rider_daily_max   DATE NOT NULL,
  shipments_max     DATE NOT NULL,
  anchor_date       DATE GENERATED ALWAYS AS (LEAST(rider_daily_max, shipments_max)) STORED,
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================================
-- Ingest tracking
-- ============================================================================

CREATE TABLE IF NOT EXISTS ingest_log (
  filename      TEXT PRIMARY KEY,
  file_hash     TEXT,                                            -- md5 of content; enables re-ingest on content change
  ingested_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  row_count     INTEGER
);

-- ============================================================================
-- Application config (replaces localStorage-only config for shared settings)
-- ----------------------------------------------------------------------------
-- Single-row table holding the global config. Admins update it; viewers read
-- it. Eliminates the bug where per-browser config drifts from what the data
-- was actually classified with.
-- ============================================================================

CREATE TABLE IF NOT EXISTS app_config (
  id                              INT  PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  analysis_window_days            INTEGER NOT NULL DEFAULT 30  CHECK (analysis_window_days BETWEEN 1 AND 365),
  new_rider_window_days           INTEGER NOT NULL DEFAULT 7   CHECK (new_rider_window_days BETWEEN 1 AND 30),
  evening_rider_threshold         NUMERIC(5,2) NOT NULL DEFAULT 80 CHECK (evening_rider_threshold BETWEEN 0 AND 100),
  cross_util_evening_threshold    NUMERIC(5,2) NOT NULL DEFAULT 70 CHECK (cross_util_evening_threshold BETWEEN 0 AND 100),
  regular_threshold               NUMERIC(5,2) NOT NULL DEFAULT 80 CHECK (regular_threshold BETWEEN 0 AND 100),
  mr3_cutoff_hour                 SMALLINT NOT NULL DEFAULT 15 CHECK (mr3_cutoff_hour BETWEEN 0 AND 23),
  del_pct_green_threshold         NUMERIC(5,2) NOT NULL DEFAULT 80 CHECK (del_pct_green_threshold BETWEEN 0 AND 100),
  del_pct_amber_threshold         NUMERIC(5,2) NOT NULL DEFAULT 60 CHECK (del_pct_amber_threshold BETWEEN 0 AND 100),
  updated_at                      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by                      UUID                                   -- references app_users.id; not FK because users may be deleted
);

INSERT INTO app_config (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

-- ============================================================================
-- Users + roles
-- ----------------------------------------------------------------------------
-- Mirrors auth.users (Supabase managed). One row per app user. RLS policies
-- on data tables check role via this table.
--
-- Roles:
--   'admin'  — full read + write app_config + manage users
--   'viewer' — read-only dashboard
-- ============================================================================

CREATE TABLE IF NOT EXISTS app_users (
  id          UUID PRIMARY KEY,                                  -- matches auth.users.id
  email       CITEXT UNIQUE NOT NULL,
  full_name   TEXT,
  role        TEXT NOT NULL DEFAULT 'viewer' CHECK (role IN ('admin', 'viewer')),
  is_active   BOOLEAN NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen   TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS app_users_role_idx ON app_users (role) WHERE is_active;

-- ============================================================================
-- The classify_riders function — SINGLE source of truth
-- ----------------------------------------------------------------------------
-- Returns a row per rider with their classification tags for the supplied
-- config. Replaces the 4 duplicated CTEs from the DuckDB codebase.
--
-- Anchor: uses data_anchor.anchor_date (LEAST of two sources). Never
-- references max() at query time.
--
-- Performance: scans rider_daily filtered to the window. With the indexes
-- above this is a bitmap index scan; ~5ms for 30 days × 5000 riders.
-- ============================================================================

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
    -- Login behaviour
    CASE
      WHEN d.morning_login_days = 0
       AND ROUND(d.evening_login_days * 100.0 / NULLIF(d.login_days, 0), 1) >= p_evening_threshold
      THEN 'Evening Rider'
      WHEN d.morning_login_days > 0
       AND ROUND(d.evening_login_days * 100.0 / NULLIF(d.login_days, 0), 1) >= p_cross_threshold
      THEN 'Cross Utilised'
      ELSE 'Morning Rider'
    END AS login_behaviour_tag,
    -- Regularity (new-rider check overrides regular/irregular)
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

-- ============================================================================
-- Row Level Security
-- ----------------------------------------------------------------------------
-- Strategy: data tables are SELECT-only for any authenticated user; only
-- service-role / admins can INSERT/UPDATE/DELETE. The Next.js API routes
-- run with the service role (server-side), so this primarily protects the
-- Supabase REST endpoints if anyone ever hits them directly.
-- ============================================================================

ALTER TABLE rider_daily          ENABLE ROW LEVEL SECURITY;
ALTER TABLE rider_day_shipments  ENABLE ROW LEVEL SECURITY;
ALTER TABLE client_day_shipments ENABLE ROW LEVEL SECURITY;
ALTER TABLE hub_mapping          ENABLE ROW LEVEL SECURITY;
ALTER TABLE cpo                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE prime_clients        ENABLE ROW LEVEL SECURITY;
ALTER TABLE data_anchor          ENABLE ROW LEVEL SECURITY;
ALTER TABLE ingest_log           ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_config           ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_users            ENABLE ROW LEVEL SECURITY;

-- Authenticated users (both admin and viewer) can read data tables.
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'rider_daily', 'rider_day_shipments', 'client_day_shipments',
    'hub_mapping', 'cpo', 'prime_clients', 'data_anchor', 'app_config'
  ] LOOP
    EXECUTE format('DROP POLICY IF EXISTS read_authenticated ON %I', t);
    EXECUTE format(
      'CREATE POLICY read_authenticated ON %I FOR SELECT TO authenticated USING (true)',
      t
    );
  END LOOP;
END $$;

-- Users can see their own row; admins can see all.
DROP POLICY IF EXISTS users_read_self ON app_users;
CREATE POLICY users_read_self ON app_users FOR SELECT TO authenticated
  USING (
    id = auth.uid()
    OR EXISTS (SELECT 1 FROM app_users a WHERE a.id = auth.uid() AND a.role = 'admin' AND a.is_active)
  );

-- Only admins can modify config.
DROP POLICY IF EXISTS config_admin_write ON app_config;
CREATE POLICY config_admin_write ON app_config FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM app_users a WHERE a.id = auth.uid() AND a.role = 'admin' AND a.is_active))
  WITH CHECK (EXISTS (SELECT 1 FROM app_users a WHERE a.id = auth.uid() AND a.role = 'admin' AND a.is_active));

-- ============================================================================
-- Helper view: classified riders at the current config
-- ----------------------------------------------------------------------------
-- Convenience for API routes that just want "the current classification."
-- Calls classify_riders() with values from app_config.
-- ============================================================================

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

-- ============================================================================
-- Done.
-- ============================================================================
