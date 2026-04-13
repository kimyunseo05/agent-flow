-- 수집부 CMS (수집부 / 태그)
-- 1) DB 생성: createdb -U postgres agent_flow_collect
-- 2) 스키마 적용: psql -U postgres -d agent_flow_collect -f db/postgresql/001_init.sql

CREATE TABLE IF NOT EXISTS collection_units (
  id SERIAL PRIMARY KEY,
  process_name TEXT NOT NULL,
  process_code TEXT NOT NULL UNIQUE,
  device_name TEXT NOT NULL DEFAULT '',
  device_ip TEXT NOT NULL DEFAULT '',
  device_port TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT '정상',
  auto_control TEXT NOT NULL DEFAULT 'ON',
  in_use BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS collection_unit_tags (
  id SERIAL PRIMARY KEY,
  collection_unit_id INTEGER NOT NULL REFERENCES collection_units (id) ON DELETE CASCADE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  tag_id TEXT NOT NULL DEFAULT '',
  data_type TEXT NOT NULL DEFAULT 'DWord',
  address TEXT NOT NULL DEFAULT '',
  ratio TEXT NOT NULL DEFAULT '1',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_collection_unit_tags_unit
  ON collection_unit_tags (collection_unit_id);
