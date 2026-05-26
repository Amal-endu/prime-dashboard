-- Migration: add assigned_sdd column (same-day received AWBs)
-- Total Allocation = AWBs where received_at_hub_time::date = SDD file date
-- Run once: psql "$DATABASE_URL" -f sql/add_assigned_sdd.sql

-- Add to rider_day_shipments
ALTER TABLE rider_day_shipments
  ADD COLUMN IF NOT EXISTS assigned_sdd INTEGER NOT NULL DEFAULT 0;

-- Add to hub_day_l8d (pre-aggregated; refreshed on each ingest)
ALTER TABLE hub_day_l8d
  ADD COLUMN IF NOT EXISTS assigned_sdd INTEGER NOT NULL DEFAULT 0;

-- client_mapping table (if not already created)
CREATE TABLE IF NOT EXISTS client_mapping (
  client_name    TEXT PRIMARY KEY,
  client_type    TEXT,
  client_bucket  TEXT,
  critical_client BOOLEAN NOT NULL DEFAULT FALSE
);
CREATE INDEX IF NOT EXISTS client_mapping_type_idx   ON client_mapping (client_type);
CREATE INDEX IF NOT EXISTS client_mapping_bucket_idx ON client_mapping (client_bucket);
CREATE INDEX IF NOT EXISTS client_mapping_critical_idx ON client_mapping (critical_client) WHERE critical_client;

-- Enable RLS on client_mapping
ALTER TABLE client_mapping ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS read_authenticated ON client_mapping;
CREATE POLICY read_authenticated ON client_mapping FOR SELECT TO authenticated USING (true);
