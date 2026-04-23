-- 모델부 CMS (MySQL, agent_flow_admin DB)
-- 실행: mysql -u [계정] -p agent_flow_admin < db/mysql/002_model_units.sql

USE agent_flow_admin;

CREATE TABLE IF NOT EXISTS model_units (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  model_name VARCHAR(255) NOT NULL,
  model_code VARCHAR(255) NOT NULL,
  status VARCHAR(50) NOT NULL DEFAULT '정상',
  auto_learn VARCHAR(10) NOT NULL DEFAULT 'ON',
  auto_control VARCHAR(10) NOT NULL DEFAULT 'ON',
  learning_cycle VARCHAR(100) NOT NULL DEFAULT '',
  resample_size VARCHAR(100) NOT NULL DEFAULT '',
  interpolate VARCHAR(10) NOT NULL DEFAULT 'on',
  fill_method VARCHAR(20) NOT NULL DEFAULT 'ffill',
  model_output_path TEXT NULL,
  model_generated_at DATETIME NULL,
  control_tag_id VARCHAR(255) NOT NULL DEFAULT '',
  min_allowed VARCHAR(100) NOT NULL DEFAULT '',
  max_allowed VARCHAR(100) NOT NULL DEFAULT '',
  change_range VARCHAR(100) NOT NULL DEFAULT '',
  auto_apply VARCHAR(50) NOT NULL DEFAULT 'after_approval',
  memo TEXT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_model_units_code (model_code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
