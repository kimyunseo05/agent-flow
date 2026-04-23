# 프로젝트 실행 명령어
```
cd /Applications/Library/agent-flow && npm start
```
<br><br>

# DB 구조
<li>MySQL → 관리자 CMS (로그인, 관리자/회원 관리)</li>
<li>PostgreSQL → 수집부 CMS (수집부, 태그 관리)</li>
<br><br>

# DB 연결 설정
<li>server.js 파일 mysqlPool, pgPool DB 연결정보 변경 필요</li>
<li>기본 관리자 계정: admin/admin</li>
<br><br>

# 관리자 CMS (로그인 / 관리자 관리 메뉴)
<li>1) 실행: mysql -u [계정] -p < db/mysql/001_init.sql</li>

```sql
CREATE DATABASE IF NOT EXISTS agent_flow_admin
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE agent_flow_admin;

CREATE TABLE IF NOT EXISTS users (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  username VARCHAR(255) NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  display_name VARCHAR(255) NULL,
  email VARCHAR(255) NULL,
  phone VARCHAR(100) NULL,
  role VARCHAR(50) NOT NULL DEFAULT 'admin',
  memo TEXT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_users_username (username)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS members (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  name VARCHAR(255) NOT NULL,
  email VARCHAR(255) NOT NULL,
  phone VARCHAR(100) NULL,
  role VARCHAR(50) NOT NULL DEFAULT 'member',
  memo TEXT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_members_email (email)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```
<br><br>

# 수집부 CMS (수집부 / 태그)
<li>1) DB 생성: createdb -U postgres agent_flow_collect</li>
<li>2) 스키마 적용: psql -U postgres -d agent_flow_collect -f db/postgresql/001_init.sql</li>

```sql
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

ALTER TABLE collection_units
  ADD COLUMN IF NOT EXISTS in_use BOOLEAN NOT NULL DEFAULT TRUE;
```
<br><br>

# 모델부 CMS
<li>1) 실행: mysql -u [계정] -p agent_flow_admin < db/mysql/002_model_units.sql</li>

```sql
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
```