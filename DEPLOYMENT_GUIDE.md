# Distributed Deployment Guide

## Setup Overview
- **agent-flow**: Local machine (macOS)
- **times**: GPU server 
- **PostgreSQL**: Linux server (210.109.80.110:5433)

## Configuration Steps

### 1. PostgreSQL Linux Server Setup
Ensure PostgreSQL is running on the Linux server:
```bash
# Check PostgreSQL status
sudo systemctl status postgresql

# Create database
createdb -U postgres agent_flow_collect

# Apply schema
psql -U postgres -d agent_flow_collect -f db/postgresql/001_init.sql
psql -U postgres -d agent_flow_collect -f db/postgresql/002_collection_units_in_use.sql
```

### 2. Agent-Flow Local Setup
```bash
# Configure environment variables in .env
cp .env.example .env
# Edit .env with your PostgreSQL Linux server details

# Install dependencies
npm install

# Start application
npm start
```

### 3. Times GPU Server Setup
```bash
# Deploy times workspace to GPU server
scp -r /Users/deiludenseu/Documents/times user@gpu-server:/path/to/deployment/

# Configure environment on GPU server
cd /path/to/deployment/times
cp .env.example .env
# Edit .env with GPU server specific settings

# Install Python dependencies
pip install -r requirements.txt

# Start dashboard
python dashboard/app.py
```

## Environment Variables

### Agent-Flow (.env)
```
# PostgreSQL Linux Server
PGHOST=210.109.80.110
PGPORT=5433
PGUSER=deiludenseu
PGPASSWORD=postgres
PGDATABASE=agent_flow_collect

# MySQL (local)
MYSQL_HOST=localhost
MYSQL_PORT=3306
MYSQL_USER=root
MYSQL_PASSWORD=
MYSQL_DATABASE=agent_flow_admin
```

### Times (.env)
```
# PostgreSQL Linux Server
DB_HOST=210.109.80.110
DB_PORT=5433
DB_NAME=robot_data
DB_USER=postgres
DB_PASSWORD=postgres

# GPU Server specific
MODEL_DIR=/data/vdb/times/new/models
PYTHON_PATH=/path/to/gpu/python
```

## Network Requirements
- Ensure firewall allows PostgreSQL connections (port 5433)
- Verify network connectivity between local machine and Linux server
- Check GPU server can access PostgreSQL server

## Troubleshooting
1. **Connection Timeout**: Check network connectivity and firewall settings
2. **Authentication Error**: Verify PostgreSQL user credentials
3. **Database Not Found**: Ensure database exists and schema is applied
