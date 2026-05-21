-- 자동학습 주기 기준 시각 (적용 시각부터 N일 대기, 매일 00:00:00 실행)
USE agent_flow_admin;

ALTER TABLE model_units
  ADD COLUMN auto_learn_anchor_at DATETIME NULL AFTER last_auto_learn_at;
