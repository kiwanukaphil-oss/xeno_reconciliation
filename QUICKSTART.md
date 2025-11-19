# Quick Start Guide - XENO Reconciliation System

Get up and running in 5 minutes!

---

## Prerequisites

- Node.js 20+
- PostgreSQL 14+
- Redis 7+

---

## Installation (5 Steps)

### 1. Install Dependencies
```bash
npm install
```

### 2. Configure Environment
```bash
cp .env.example .env
```

Edit `.env` and update:
```env
DATABASE_URL="postgresql://YOUR_USERNAME:YOUR_PASSWORD@localhost:5432/xeno_reconciliation"
```

### 3. Set Up Database
```bash
npm run prisma:generate
npm run prisma:migrate
npm run prisma:seed
```

### 4. Start Services

**Terminal 1 - API Server:**
```bash
npm run dev
```

**Terminal 2 - Background Worker:**
```bash
npm run worker
```

### 5. Test Upload

```bash
curl -X POST http://localhost:3000/api/fund-upload/upload \
  -F "file=@Reference Docs/Client Fund transactions.csv" \
  -F "uploadedBy=testuser"
```

---

## Verify Installation

### Check Health
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

### Check Database (GUI)
```bash
npm run prisma:studio
```

Opens browser at `http://localhost:5555`

---

## Upload Workflow

### 1. Upload File
```bash
curl -X POST http://localhost:3000/api/fund-upload/upload \
  -F "file=@yourfile.csv" \
  -F "uploadedBy=your-name"
```

Response:
```json
{
  "message": "File uploaded and queued for processing",
  "batchId": "abc-123",
  "status": "queued"
}
```

### 2. Check Status
```bash
curl http://localhost:3000/api/fund-upload/batches/{batchId}/status
```

### 3. If New Entities Detected
```bash
# View new entities
curl http://localhost:3000/api/fund-upload/batches/{batchId}/new-entities

# Approve entities
curl -X POST http://localhost:3000/api/fund-upload/batches/{batchId}/approve-entities \
  -H "Content-Type: application/json" \
  -d '{"approvalStatus": "approved", "approvedBy": "your-name"}'
```

### 4. View Results
```bash
# Get goal transactions
curl http://localhost:3000/api/goal-transactions

# Export to CSV
curl http://localhost:3000/api/goal-transactions/export/csv > output.csv
```

---

## File Format (CSV or Excel)

The system accepts **CSV** (.csv) and **Excel** (.xlsx, .xls) files.

Required columns:
```csv
transactionDate,clientName,fundCode,amount,units,transactionType,bidPrice,offerPrice,midPrice,dateCreated,goalTitle,goalNumber,accountNumber,accountType,accountCategory
```

Example:
```csv
2018-07-24,Ibrahim Buya,XUBF,300000,2681.59122,DEPOSIT,111.68,111.8,111.91,2020-11-15,Education,701-5558635193a,701-555863519,PERSONAL,GENERAL
```

---

## Troubleshooting

### Port Already in Use
Change PORT in `.env`:
```env
PORT=3001
```

### Database Error
Check PostgreSQL is running:
```bash
psql -h localhost -U postgres -d xeno_reconciliation
```

### Redis Error
Check Redis is running:
```bash
redis-cli ping
# Should return: PONG
```

### Worker Not Processing
Check both terminals are running and no errors in logs.

---

## Key Concepts

**goalTransactionCode**: Links related fund transactions
- Format: `{date}-{account}-{goal}`
- Example: `2018-07-24-701-555863519-701-5558635193a`

**Goal Transaction**: Aggregated view
- Total amount = sum of 4 fund amounts
- Funds: XUMMF, XUBF, XUDEF, XUREF

---

## Useful Commands

```bash
# Development
npm run dev              # Start API server
npm run worker           # Start background worker
npm run build            # Build for production

# Database
npm run prisma:studio    # Open database GUI
npm run prisma:migrate   # Run migrations

# Code Quality
npm run lint             # Lint code
npm run format           # Format code
```

---

## Next Steps

- See [SETUP.md](SETUP.md) for detailed setup
- See [README.md](README.md) for full documentation
- See [PROJECT_SUMMARY.md](PROJECT_SUMMARY.md) for architecture overview

---

**Ready to process 100,000+ fund transactions!**

*Last Updated: 2025-11-18*
