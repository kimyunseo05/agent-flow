# Agent-Flow 배포 가이드라인

### 공통 요구사항
- Node.js 18.x 이상
- Python 3.8 이상 (PLC 수집용)
- MySQL 8.0 이상
- PostgreSQL 14.x 이상

## 리눅스 배포 가이드

### 1. 시스템 준비

```bash
# 시스템 업데이트
sudo apt update && sudo apt upgrade -y

# 필수 패키지 설치
sudo apt install -y nodejs npm python3 python3-pip mysql-server postgresql git
```

### 2. MySQL 설정

```bash
# MySQL 서비스 시작
sudo systemctl start mysql
sudo systemctl enable mysql

# 데이터베이스 생성
sudo mysql -u root -p
```

```sql
CREATE DATABASE agent_flow_admin;
CREATE USER 'root'@'localhost' IDENTIFIED BY 'your_password';
GRANT ALL PRIVILEGES ON agent_flow_admin.* TO 'root'@'localhost';
FLUSH PRIVILEGES;
EXIT;
```

### 3. PostgreSQL 설정

```bash
# PostgreSQL 서비스 시작
sudo systemctl start postgresql
sudo systemctl enable postgresql

# 데이터베이스 생성
sudo -u postgres psql
```

```sql
CREATE DATABASE agent_flow_collect;
CREATE USER deiludenseu WITH SUPERUSER;
ALTER USER deiludenseu WITH PASSWORD 'your_password';
GRANT ALL PRIVILEGES ON DATABASE agent_flow_collect TO deiludenseu;
\q
```

### 4. PostgreSQL 설정 수정

```bash
# postgresql.conf 수정
sudo nano /etc/postgresql/14/main/postgresql.conf
```

```
listen_addresses = '*'
port = 5433
```

```bash
# pg_hba.conf 수정
sudo nano /etc/postgresql/14/main/pg_hba.conf
```

```
# 마지막 라인에 추가
host all all 0.0.0.0/0 trust
```

```bash
# PostgreSQL 재시작
sudo systemctl restart postgresql
```

### 5. 애플리케이션 배포

```bash
# 프로젝트 복사
git clone <repository-url> /opt/agent-flow
cd /opt/agent-flow

# 의존성 설치
npm install

# 환경 변수 설정
cp .env.example .env
nano .env
```

```env
# MySQL
MYSQL_HOST=localhost
MYSQL_PORT=3306
MYSQL_USER=root
MYSQL_PASSWORD=your_password
MYSQL_DATABASE=agent_flow_admin

# PostgreSQL
PGHOST=localhost
PGPORT=5433
PGUSER=deiludenseu
PGPASSWORD=your_password
PGDATABASE=agent_flow_collect

# 애플리케이션
PORT=3000
```

### 6. 데이터베이스 스키마 적용

```bash
# MySQL 스키마
mysql -u root -p agent_flow_admin < db/mysql/001_init.sql

# PostgreSQL 스키마
psql -U deiludenseu -d agent_flow_collect -f db/postgresql/001_init.sql
psql -U deiludenseu -d agent_flow_collect -f db/postgresql/002_collection_units_in_use.sql
```

### 7. 서비스 등록 (systemd)

```bash
# 서비스 파일 생성
sudo nano /etc/systemd/system/agent-flow.service
```

```ini
[Unit]
Description=Agent-Flow Application
After=network.target mysql.service postgresql.service

[Service]
Type=simple
User=your-user
WorkingDirectory=/opt/agent-flow
ExecStart=/usr/bin/node server.js
Restart=always
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
```

```bash
# 서비스 시작
sudo systemctl daemon-reload
sudo systemctl start agent-flow
sudo systemctl enable agent-flow
```

## 윈도우 배포 가이드

### 1. 소프트웨어 설치

#### Node.js 설치
1. [Node.js 공식 웹사이트](https://nodejs.org/)에서 LTS 버전 다운로드
2. 설치 마법사 실행 및 기본 설정으로 설치

#### Python 설치
1. [Python 공식 웹사이트](https://www.python.org/downloads/)에서 Python 3.8+ 다운로드
2. 설치 시 "Add Python to PATH" 체크

#### MySQL 설치
1. [MySQL 공식 웹사이트](https://dev.mysql.com/downloads/mysql/)에서 MySQL Community Server 다운로드
2. 설치 마법사 실행
3. Root 비밀번호 설정

#### PostgreSQL 설치
1. [PostgreSQL 공식 웹사이트](https://www.postgresql.org/download/windows/)에서 다운로드
2. 설치 마법사 실행
3. superuser 비밀번호 설정

### 2. MySQL 설정

```cmd
# MySQL 서비스 시작
net start MySQL80

# MySQL 접속
mysql -u root -p
```

```sql
CREATE DATABASE agent_flow_admin;
CREATE USER 'root'@'localhost' IDENTIFIED BY 'your_password';
GRANT ALL PRIVILEGES ON agent_flow_admin.* TO 'root'@'localhost';
FLUSH PRIVILEGES;
EXIT;
```

### 3. PostgreSQL 설정

```cmd
# PostgreSQL 서비스 시작
net start postgresql-x64-14

# PostgreSQL 접속
psql -U postgres
```

```sql
CREATE DATABASE agent_flow_collect;
CREATE USER deiludenseu WITH SUPERUSER;
ALTER USER deiludenseu WITH PASSWORD 'your_password';
GRANT ALL PRIVILEGES ON DATABASE agent_flow_collect TO deiludenseu;
\q
```

### 4. PostgreSQL 설정 수정

```cmd
# postgresql.conf 수정 (C:\Program Files\PostgreSQL\14\data\)
notepad C:\Program Files\PostgreSQL\14\data\postgresql.conf
```

```
listen_addresses = '*'
port = 5433
```

```cmd
# pg_hba.conf 수정
notepad C:\Program Files\PostgreSQL\14\data\pg_hba.conf
```

```
# 마지막 라인에 추가
host all all 0.0.0.0/0 trust
```

```cmd
# PostgreSQL 서비스 재시작
net stop postgresql-x64-14
net start postgresql-x64-14
```

### 5. 애플리케이션 배포

```cmd
# 프로젝트 폴더로 이동
cd C:\agent-flow

# 의존성 설치
npm install

# 환경 변수 설정
copy .env.example .env
notepad .env
```

```env
# MySQL
MYSQL_HOST=localhost
MYSQL_PORT=3306
MYSQL_USER=root
MYSQL_PASSWORD=your_password
MYSQL_DATABASE=agent_flow_admin

# PostgreSQL
PGHOST=localhost
PGPORT=5433
PGUSER=deiludenseu
PGPASSWORD=your_password
PGDATABASE=agent_flow_collect

# 애플리케이션
PORT=3000
```

### 6. 데이터베이스 스키마 적용

```cmd
# MySQL 스키마
mysql -u root -p agent_flow_admin < db\mysql\001_init.sql

# PostgreSQL 스키마
psql -U deiludenseu -d agent_flow_collect -f db\postgresql\001_init.sql
psql -U deiludenseu -d agent_flow_collect -f db\postgresql\002_collection_units_in_use.sql
```

### 7. 애플리케이션 시작

```cmd
# 개발 환경
npm start

# 또는 배치 파일 사용
start.bat
```

### 8. Windows 서비스 등록 (선택사항)

```cmd
# NSSM (Non-Sucking Service Manager) 설치
# https://nssm.cc/download

# 서비스 등록
nssm install AgentFlow "C:\Program Files\nodejs\node.exe" "C:\agent-flow\server.js"
nssm set AgentFlow AppDirectory C:\agent-flow
nssm set AgentFlow DisplayName Agent-Flow
nssm set AgentFlow Description Agent-Flow Application
nssm start AgentFlow
```

## Python PLC 수집기 설정

### 리눅스

```bash
# Python 의존성 설치
pip3 install -r requirements-collector.txt

# 환경 변수 설정
export COLLECTOR_UNIT_ID=1
export COLLECTOR_PROCESS_CODE=AIR_CLEANER
export PGHOST=localhost
export PGPORT=5433
export PGUSER=deiludenseu
export PGPASSWORD=your_password
export PGDATABASE=agent_flow_collect

# 수집기 실행
python3 scripts/plc_collector.py
```

### 윈도우

```cmd
# Python 의존성 설치
pip install -r requirements-collector.txt

# 환경 변수 설정
set COLLECTOR_UNIT_ID=1
set COLLECTOR_PROCESS_CODE=AIR_CLEANER
set PGHOST=localhost
set PGPORT=5433
set PGUSER=deiludenseu
set PGPASSWORD=your_password
set PGDATABASE=agent_flow_collect

# 수집기 실행
python scripts\plc_collector.py
```

## 방화벽 설정

### 리눅스 (UFW)

```bash
# 방화벽 활성화
sudo ufw enable

# 포트 허용
sudo ufw allow 3000/tcp  # 애플리케이션
sudo ufw allow 3306/tcp  # MySQL
sudo ufw allow 5433/tcp  # PostgreSQL
sudo ufw allow 22/tcp    # SSH
```

### 윈도우

```cmd
# 방화벽 규칙 추가
netsh advfirewall firewall add rule name="Agent-Flow" dir=in action=allow protocol=TCP localport=3000
netsh advfirewall firewall add rule name="MySQL" dir=in action=allow protocol=TCP localport=3306
netsh advfirewall firewall add rule name="PostgreSQL" dir=in action=allow protocol=TCP localport=5433
```

## 모니터링 및 로그

### 리눅스

```bash
# 서비스 상태 확인
sudo systemctl status agent-flow

# 로그 확인
sudo journalctl -u agent-flow -f

# 로그 파일
tail -f /opt/agent-flow/logs/*.log
```

### 윈도우

```cmd
# 이벤트 뷰어에서 로그 확인
eventvwr.msc

# 로그 파일
type logs\*.log
```
