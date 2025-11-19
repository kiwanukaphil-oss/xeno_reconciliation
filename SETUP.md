# XENO Reconciliation System - Setup Guide

## Prerequisites

Ensure you have the following installed:
- **Node.js** 20+ ([Download](https://nodejs.org/))
- **PostgreSQL** 14+ ([Download](https://www.postgresql.org/download/))
- **Redis** 7+ ([Download](https://redis.io/download))

## Installation Steps

### 1. Install Dependencies

```bash
npm install
```

### 2. Set Up Environment Variables

Create a `.env` file in the root directory:

```bash
cp .env.example .env
```

Edit `.env` with your configuration:

```env
# Database - Update with your PostgreSQL credentials
DATABASE_URL="postgresql://username:password@localhost:5432/xeno_reconciliation?schema=public"

# Redis
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=

# Server
PORT=3000
NODE_ENV=development

# File Upload
UPLOAD_DIR=uploads/temp
MAX_FILE_SIZE_MB=100

# Processing
BATCH_INSERT_SIZE=500
MAX_CONCURRENT_JOBS=5

# Validation
DATE_RANGE_YEARS_PAST=10
DATE_RANGE_YEARS_FUTURE=0
AMOUNT_MIN=1000
AMOUNT_MAX=1000000000
UNIT_TRUST_TOLERANCE=0.01
FUND_DISTRIBUTION_TOLERANCE=0.01

# Logging
LOG_LEVEL=info
LOG_FILE=logs/app.log
```

### 3. Set Up PostgreSQL Database

Create a database:

```sql
CREATE DATABASE xeno_reconciliation;
```

### 4. Generate Prisma Client

```bash
npm run prisma:generate
```

### 5. Run Database Migrations

```bash
npm run prisma:migrate
```

This will create all tables, indexes, and constraints.

### 6. Seed Initial Data

```bash
npm run prisma:seed
```

This will populate:
- **4 Funds**: XUMMF, XUBF, XUDEF, XUREF
- **24 Validation Rules**
- **Sample Fund Prices** (last 7 days)

### 7. Start Redis

Ensure Redis is running:

```bash
# Windows (if installed as service)
redis-server

# Linux/Mac
sudo systemctl start redis
# or
redis-server
```

### 8. Start the Application

You need to run **two processes**:

#### Terminal 1: API Server

```bash
npm run dev
```

This starts the Express API server on port 3000.

#### Terminal 2: Background Worker

```bash
npm run worker
```

This starts the BullMQ worker for processing file uploads.

---

## Verification

### Check API Health

```bash
curl http://localhost:3000/health
```

Expected response:
```json
{
  "status": "ok",
  "timestamp": "2025-11-18T...",
  "uptime": 10.5
}
```

### Check Database Connection

Open Prisma Studio:

```bash
npm run prisma:studio
```

This opens a GUI at `http://localhost:5555` to browse your database.

---

## Testing the Upload Pipeline

### 1. Prepare a Test File

The system accepts **CSV** or **Excel** files (.csv, .xlsx, .xls).

Use the reference file: `Reference Docs/Client Fund transactions.csv`

Or create a CSV/Excel file with this format:

```csv
transactionDate,clientName,fundCode,amount,units,transactionType,bidPrice,offerPrice,midPrice,dateCreated,goalTitle,goalNumber,accountNumber,accountType,accountCategory
2018-07-24,Ibrahim Buya,XUBF,300000,2681.59122,DEPOSIT,111.68,111.8,111.91,2020-11-15,Education,701-5558635193a,701-555863519,PERSONAL,GENERAL
2018-07-24,Ibrahim Buya,XUMMF,39500,396.98,DEPOSIT,99.50,99.50,99.50,2020-11-15,Education,701-5558635193a,701-555863519,PERSONAL,GENERAL
2018-07-24,Ibrahim Buya,XUDEF,70500,484.54,DEPOSIT,145.20,145.50,145.35,2020-11-15,Education,701-5558635193a,701-555863519,PERSONAL,GENERAL
2018-07-24,Ibrahim Buya,XUREF,90000,502.23,DEPOSIT,178.90,179.30,179.10,2020-11-15,Education,701-5558635193a,701-555863519,PERSONAL,GENERAL
```

### 2. Upload the File

```bash
curl -X POST http://localhost:3000/api/fund-upload/upload \
  -F "file=@Reference Docs/Client Fund transactions.csv" \
  -F "uploadedBy=testuser"
```

Expected response:
```json
{
  "message": "File uploaded and queued for processing",
  "batchId": "uuid-here",
  "fileName": "Client Fund transactions.csv",
  "fileSize": 1234,
  "rowCount": 4,
  "status": "queued"
}
```

### 3. Check Upload Status

```bash
curl http://localhost:3000/api/fund-upload/batches/{batchId}/status
```

Expected response:
```json
{
  "batchId": "uuid-here",
  "batchNumber": "BATCH-20251118-12345",
  "fileName": "Client Fund transactions.csv",
  "processingStatus": "WAITING_FOR_APPROVAL",
  "validationStatus": "PASSED",
  "totalRecords": 4,
  "processedRecords": 4,
  "failedRecords": 0,
  "uploadedAt": "2025-11-18T...",
  "processingStartedAt": "2025-11-18T...",
  "processingCompletedAt": null
}
```

### 4. Check New Entities (if waiting for approval)

```bash
curl http://localhost:3000/api/fund-upload/batches/{batchId}/new-entities
```

### 5. Approve Entities

```bash
curl -X POST http://localhost:3000/api/fund-upload/batches/{batchId}/approve-entities \
  -H "Content-Type: application/json" \
  -d '{
    "approvalStatus": "approved",
    "approvedBy": "testuser"
  }'
```

### 6. View Goal Transactions

```bash
curl http://localhost:3000/api/goal-transactions
```

Expected response:
```json
{
  "count": 1,
  "data": [
    {
      "goalTransactionCode": "2018-07-24-701-555863519-701-5558635193a",
      "transactionDate": "2018-07-24",
      "clientName": "Ibrahim Buya",
      "accountNumber": "701-555863519",
      "goalTitle": "Education",
      "goalNumber": "701-5558635193a",
      "totalAmount": 500000,
      "XUMMF": 39500,
      "XUBF": 300000,
      "XUDEF": 70500,
      "XUREF": 90000,
      "totalUnits": 4065.34,
      "fundTransactionCount": 4
    }
  ]
}
```

### 7. Export Goal Transactions to CSV

```bash
curl http://localhost:3000/api/goal-transactions/export/csv > goal-transactions.csv
```

---

## Development Commands

```bash
# Start API server (development with auto-reload)
npm run dev

# Start background worker (development with auto-reload)
npm run worker

# Build for production
npm run build

# Start production server
npm start

# Run tests
npm test

# Lint code
npm run lint

# Format code
npm run format

# Open Prisma Studio (database GUI)
npm run prisma:studio

# Create new migration
npm run prisma:migrate

# Reset database (WARNING: deletes all data)
npx prisma migrate reset
```

---

## Architecture Overview

### Processing Pipeline

```
1. Upload CSV → Create UploadBatch (QUEUED)
2. Parse CSV → Generate goalTransactionCode for each row
3. Validate Transactions → Field validation + unit trust math
4. Validate Goal Transaction Groups → Consistency + completeness
5. Detect New Entities → Identify new clients/accounts/goals
6. IF new entities → WAITING_FOR_APPROVAL → Pause
7. Approve Entities → Create in database
8. Save Fund Transactions → Batch inserts (500/batch)
9. Update Batch → COMPLETED with statistics
```

### Key Concepts

**goalTransactionCode**: Links related fund transactions
- Format: `{YYYY-MM-DD}-{accountNumber}-{goalNumber}`
- Example: `2018-07-24-701-555863519-701-5558635193a`
- All fund transactions with same code = 1 goal transaction

**Goal Transaction**: Virtual/derived by grouping fund transactions
- Total amount = sum of all fund amounts
- Individual fund amounts: XUMMF, XUBF, XUDEF, XUREF

---

## Troubleshooting

### Issue: Port 3000 already in use

Change the PORT in `.env`:
```env
PORT=3001
```

### Issue: Database connection error

Check PostgreSQL is running and credentials in `.env` are correct:
```bash
# Test connection
psql -h localhost -U username -d xeno_reconciliation
```

### Issue: Redis connection error

Check Redis is running:
```bash
redis-cli ping
# Should return: PONG
```

### Issue: Worker not processing jobs

Check worker logs in terminal. Ensure both API and worker are running.

### Issue: File upload fails

Check:
- Upload directory exists: `uploads/temp/`
- File size < 100MB
- File is CSV or Excel format (.csv, .xlsx, .xls)

---

## Next Steps

- **Add authentication**: Implement user authentication and authorization
- **Add tests**: Create unit and integration tests
- **Add reconciliation reports**: Unit balance tracking, distribution validation
- **Add Excel export**: Generate detailed Excel reports
- **Deploy to production**: Set up production environment

---

## Support

For issues and questions, refer to:
- [README.md](README.md) - Project overview
- [claude.md](claude.md) - Development log and architecture
- [prisma/schema.prisma](prisma/schema.prisma) - Database schema

---

*Last Updated: 2025-11-18*
