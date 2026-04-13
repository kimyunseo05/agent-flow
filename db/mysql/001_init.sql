-- 관리자 CMS (로그인 / 관리자 관리 메뉴)
-- 실행: mysql -u ... -p ... < db/mysql/001_init.sql

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
