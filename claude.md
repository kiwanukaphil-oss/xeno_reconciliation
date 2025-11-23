# XENO Reconciliation System - Development Log

## Project Overview
Building a robust client fund transaction ingestion system for managing unit trust investments across multiple funds. The system handles client portfolios with accounts, goals, and fund transactions with support for 100,000+ transaction uploads.

---

## Architecture Summary

### Core Concept
- **Hierarchy**: Client → Account → Goal → Fund Transactions
- **Goal Transaction Linking**: Fund transactions are linked via `goalTransactionCode` (format: `{date}-{accountNumber}-{goalNumber}`)
- **Fund Distribution**: Each goal transaction distributes across 4 funds (XUMMF, XUBF, XUDEF, XUREF) based on risk tolerance
- **Processing Model**: Queue-based asynchronous processing inspired by proven GL upload architecture

### Key Design Decisions
1. **No separate GoalTransaction table** - Goal transactions are virtual/derived by grouping fund transactions
2. **goalTransactionCode as primary linking mechanism** - All fund transactions with same code belong together
3. **Approval workflow** for new clients/accounts/goals detected during upload
4. **Streaming CSV parser** for handling 100K+ records efficiently
5. **Batch database operations** (500-1000 records per transaction) for performance

---

## Data Model

### Core Entities
```
Client
├── Account (accountNumber, accountType, accountCategory)
│   └── Goal (goalNumber, goalTitle, fundDistribution JSON)
│       └── FundTransaction (goalTransactionCode, amount, units, prices)
│
Fund (fundCode: XUMMF, XUBF, XUDEF, XUREF)
└── FundPrice (daily prices: bid, offer, mid)

UploadBatch (tracks processing status, validation results, statistics)
└── FundTransaction (individual fund transactions from CSV)
└── InvalidFundTransaction (failed validation records)
```

### Critical Fields
- **FundTransaction.goalTransactionCode**: Links related fund transactions (indexed)
- **Goal.fundDistribution**: JSON with percentage allocations per fund
- **UploadBatch.processingStatus**: QUEUED → PARSING → VALIDATING → PROCESSING → COMPLETED/FAILED
- **UploadBatch.newEntitiesStatus**: Approval workflow for new clients/accounts/goals

---

## Technology Stack
- **Runtime**: Node.js + TypeScript
- **Framework**: Express.js
- **ORM**: Prisma
- **Database**: PostgreSQL
- **Queue**: BullMQ + Redis
- **File Parsing**: PapaParse (streaming)
- **Validation**: Custom validators + business rules
- **Reports**: ExcelJS

---

## Project Structure
```
XENO Reconciliation/
├── prisma/
│   ├── schema.prisma
│   ├── migrations/
│   └── seed.ts
├── src/
│   ├── config/
│   ├── services/
│   │   ├── fund-upload/
│   │   │   ├── FundFileProcessor.ts
│   │   │   ├── parsers/
│   │   │   ├── validators/
│   │   │   ├── entity-management/
│   │   │   ├── database/
│   │   │   └── calculators/
│   │   ├── reconciliation/
│   │   └── reporting/
│   ├── routes/
│   ├── middleware/
│   ├── utils/
│   └── app.ts
├── uploads/temp/
└── tests/
```

---

## Processing Pipeline

### Phase 1: Upload & Queue
1. POST /api/fund-upload/upload
2. Validate file (CSV, max 100MB)
3. Create UploadBatch (status: QUEUED)
4. Enqueue job: "process-fund-transactions"
5. Return 202 Accepted

### Phase 2: Background Processing
1. Parse CSV with streaming (generate goalTransactionCode for each row)
2. Validate each transaction (required fields, dates, amounts, unit trust math)
3. Validate goal transaction groups (consistency, completeness, distribution)
4. Detect new entities (clients, accounts, goals)
5. **IF new entities** → status: WAITING_FOR_APPROVAL → pause
6. **ELSE** → Save to database (batched inserts) → status: COMPLETED

### Phase 3: Post-Approval (if needed)
1. Create approved clients/accounts/goals
2. Resume processing from step 2
3. Finalize and update batch status

---

## Validation Rules

### Fund Transaction Level
- Required fields: transactionDate, clientName, fundCode, amount, units, prices, accountNumber, goalNumber
- Date validation: valid format, not in future, within acceptable range
- Amount validation: > 0, within limits
- Unit trust math: units = amount / offerPrice (±0.01 tolerance)
- Price validation: bidPrice ≤ midPrice ≤ offerPrice
- Reference data: fundCode exists, prices available

### Goal Transaction Level (grouped by goalTransactionCode)
- Consistency: same client, account, goal, date across all fund transactions
- Completeness: all 4 funds present (warning if not)
- No duplicate fund codes
- Distribution validation: amounts match goal.fundDistribution percentages (±1% tolerance)

---

## Key Services

### GoalTransactionCodeGenerator
- Generates: `{YYYY-MM-DD}-{accountNumber}-{goalNumber}`
- Validates format
- Parses components from code

### FundCSVParser
- Streams large CSV files
- Auto-generates goalTransactionCode for each row
- Handles multiple date formats
- Parses amounts with currency symbols

### GoalTransactionValidator
- Groups fund transactions by goalTransactionCode
- Validates consistency across group
- Checks completeness (4 funds)
- Validates distribution percentages

### GoalTransactionService
- Aggregates fund transactions into goal transactions
- Returns data matching reference CSV format:
  ```
  transactionDate, clientName, accountNumber, goalTitle, goalNumber,
  Amount (total), XUMMF, XUBF, XUDEF, XUREF
  ```
- Provides drill-down to individual fund transactions

### ReconciliationService
- Validates completeness of goal transactions
- Checks fund distribution accuracy
- Detects orphaned transactions
- Unit balance reconciliation

---

## API Endpoints

### Upload Management
- POST /api/fund-upload/upload
- GET /api/fund-upload/batches/:batchId/status
- GET /api/fund-upload/batches/:batchId/summary
- POST /api/fund-upload/batches/:batchId/cancel

### Entity Approval
- GET /api/fund-upload/batches/:batchId/new-entities
- POST /api/fund-upload/batches/:batchId/approve-entities

### Goal Transactions (Aggregated View)
- GET /api/goal-transactions (with filters)
- GET /api/goal-transactions/:goalTransactionCode
- GET /api/goal-transactions/:goalTransactionCode/fund-transactions
- GET /api/goal-transactions/export (CSV matching reference format)

### Fund Transactions
- GET /api/fund-transactions (with filters)
- GET /api/fund-transactions/:id
- PUT /api/fund-transactions/:id
- DELETE /api/fund-transactions/:id

### Fund Prices
- POST /api/fund-prices/upload - Upload daily fund prices (Excel with 3 tabs: bid, mid, offer)
- GET /api/fund-prices/template/download - Download fund price template Excel file
- GET /api/fund-prices - Get fund prices with filters (fundCode, date range, pagination)
- GET /api/fund-prices/latest - Get latest prices for all funds
- GET /api/fund-prices/:fundCode/:date - Get price for specific fund and date
- DELETE /api/fund-prices/:id - Delete a fund price record

**Fund Price Upload Format:**
- Excel file with 3 tabs: **bid**, **mid**, **offer**
- Each tab has columns: Date | XUMMF | XUBF | XUDEF | XUREF
- System validates: bidPrice ≤ midPrice ≤ offerPrice
- Supports both new 3-tab format and legacy row format for backward compatibility

### Reporting
- GET /api/reports/fund-balances
- GET /api/reports/client-portfolio
- GET /api/reports/transaction-history
- GET /api/reports/reconciliation

### Master Data
- GET /api/clients
- GET /api/accounts
- GET /api/goals
- GET /api/funds

---

## Current Status

### Completed ✅
- ✅ Architecture design
- ✅ Data model design (Prisma schema with all entities)
- ✅ goalTransactionCode linking strategy
- ✅ Processing pipeline design
- ✅ Validation rules defined (24 rules seeded)
- ✅ Project structure and configuration
- ✅ CSV parser with streaming support (100K+ records)
- ✅ GoalTransactionCode generator
- ✅ Validation engine (field + goal transaction group validation)
- ✅ Entity detection and creation
- ✅ Upload processor with queue integration
- ✅ Background worker (BullMQ)
- ✅ API endpoints (upload, status, approval workflow)
- ✅ Goal transaction reporting service
- ✅ Database repositories
- ✅ Error handling and logging
- ✅ Fund price upload and management
- ✅ Fund price viewing (latest and historical)

### Ready for Testing 🧪
- 🧪 Full upload pipeline
- 🧪 CSV parsing with 100K+ records
- 🧪 Validation engine
- 🧪 Approval workflow
- 🧪 Goal transaction aggregation

### Pending ⏳
- ⏳ Advanced reconciliation services
- ⏳ Excel report generation
- ⏳ Additional reporting endpoints
- ⏳ Testing suite (Jest)
- ⏳ Authentication & authorization

---

## Reference Files
- `Reference Docs/Client Fund transactions.csv` - Sample fund transaction data
- `Reference Docs/goal transaction.csv` - Aggregated goal transaction format
- `Reference Docs/fund_prices_template.xlsx` - Fund prices upload template (3-tab format)

---

## Development Notes

### Performance Considerations
- Stream CSV parsing for memory efficiency
- Batch database inserts (500-1000 per transaction)
- Index on goalTransactionCode for fast grouping
- Index on transactionDate, accountId, goalId for queries

### Business Rules
- 4 funds: XUMMF, XUBF, XUDEF, XUREF
- Account number format: XXX-XXXXXXXXX
- Goal number format: {accountNumber}{suffix} (e.g., "701-5558635193a")
- Unit trust calculation: units = amount / offerPrice (deposits)

### Future Enhancements
- Support for variable fund counts
- Dynamic fund distribution percentages
- Goal performance tracking
- Portfolio rebalancing
- Client reporting dashboard

---

## Next Steps
1. Initialize Node.js project with TypeScript
2. Set up Prisma with PostgreSQL
3. Create database schema
4. Implement CSV parser with goalTransactionCode generation
5. Build validation engine
6. Create upload processor with queue
7. Implement API endpoints
8. Add reconciliation logic
9. Build reporting services
10. Testing and optimization

---

*Last Updated: 2025-11-18*
