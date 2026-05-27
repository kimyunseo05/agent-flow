-- 수집부 태그 description 컬럼
ALTER TABLE collection_unit_tags
  ADD COLUMN IF NOT EXISTS description VARCHAR(500) NOT NULL DEFAULT '';
