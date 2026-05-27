-- 모델부 태그 description 컬럼
ALTER TABLE model_unit_tags
  ADD COLUMN description VARCHAR(500) NOT NULL DEFAULT '' AFTER tag_id;
