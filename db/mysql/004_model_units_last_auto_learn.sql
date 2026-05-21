-- 모델 자동학습 스케줄 추적
USE agent_flow_admin;

ALTER TABLE model_units
  ADD COLUMN last_auto_learn_at DATETIME NULL AFTER model_generated_at;
