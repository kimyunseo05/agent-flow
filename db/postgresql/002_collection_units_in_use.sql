-- 기존 DB에 사용여부 컬럼 추가
-- psql -U postgres -d agent_flow_collect -f db/postgresql/002_collection_units_in_use.sql

ALTER TABLE collection_units
  ADD COLUMN IF NOT EXISTS in_use BOOLEAN NOT NULL DEFAULT TRUE;
