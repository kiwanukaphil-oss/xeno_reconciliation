# XENO Reconciliation System

A robust client fund transaction ingestion and reconciliation system for managing unit trust investments across multiple funds.

## Features

- **High-Volume Processing**: Handle 100,000+ fund transactions per file upload
- **Multiple File Formats**: Support for CSV and Excel (.csv, .xlsx, .xls) files
- **Queue-Based Architecture**: Asynchronous processing with BullMQ and Redis
- **Client Hierarchy**: Client → Account → Goal → Fund Transactions
- **Goal Transaction Linking**: Automatic grouping of related fund transactions via `goalTransactionCode`
- **Multi-Fund Distribution**: Support for 4 funds (XUMMF, XUBF, XUDEF, XUREF) with configurable allocations
- **Comprehensive Validation**: Field validation, unit trust math, goal transaction consistency
- **Approval Workflow**: Review and approve new clients/accounts/goals before processing
- **Reconciliation Engine**: Unit balance tracking, distribution validation, completeness checks
- **Reporting**: Fund balances, portfolio summaries, transaction history, reconciliation reports

## Technology Stack

- **Runtime**: Node.js 20+ with TypeScript
- **Framework**: Express.js
- **Database**: PostgreSQL with Prisma ORM
- **Queue**: BullMQ with Redis
- **File Processing**: PapaParse (streaming CSV) + XLSX (Excel)
- **Reporting**: ExcelJS

## Quick Start

### Prerequisites

- Node.js 20+
- PostgreSQL 14+
- Redis 7+

### Installation

```bash
# Clone the repository
git clone <repository-url>
cd xeno-reconciliation

# Install dependencies
npm install

# Set up environment variables
cp .env.example .env
# Edit .env with your database and Redis credentials

# Generate Prisma client
npm run prisma:generate

# Run database migrations
npm run prisma:migrate

# Seed initial data (funds, validation rules)
npm run prisma:seed
```

### Running the Application

```bash
# Start the API server (development)
npm run dev

# Start the background worker (in a separate terminal)
npm run worker

# Production build
npm run build
npm start
```

### API Documentation

Base URL: `http://localhost:3000/api`

#### Upload Fund Transactions
```bash
POST /fund-upload/upload
Content-Type: multipart/form-data

# Returns: { batchId, status: "queued" }
```

#### Check Upload Status
```bash
GET /fund-upload/batches/:batchId/status

# Returns: { processingStatus, totalRecords, processedRecords, etc. }
```

#### Get Goal Transactions (Aggregated)
```bash
GET /goal-transactions?clientId=xxx&startDate=2018-01-01&endDate=2018-12-31

# Returns aggregated goal transactions matching CSV format
```

#### Export Goal Transactions to CSV
```bash
GET /goal-transactions/export?clientId=xxx&startDate=xxx&endDate=xxx
```

## Architecture

### Data Flow

```
1. Upload CSV File → Create UploadBatch (QUEUED)
2. Enqueue Background Job → Parse CSV
3. Generate goalTransactionCode for each row
4. Validate Transactions (fields, math, prices)
5. Validate Goal Transaction Groups (consistency, completeness)
6. Detect New Entities (clients, accounts, goals)
7. IF new entities → WAITING_FOR_APPROVAL
8. Approve Entities → Create in Database
9. Save Fund Transactions (batched inserts)
10. Update Batch Status → COMPLETED
```

### Goal Transaction Linking

Fund transactions are linked via `goalTransactionCode`:
- **Format**: `{YYYY-MM-DD}-{accountNumber}-{goalNumber}`
- **Example**: `2018-07-24-701-555863519-701-5558635193a`

All fund transactions with the same code belong to the same goal transaction.

### Database Schema

```
Client
├── Account (accountNumber, type, category)
│   └── Goal (goalNumber, title, fundDistribution)
│       └── FundTransaction (goalTransactionCode, amount, units)
│
Fund (XUMMF, XUBF, XUDEF, XUREF)
└── FundPrice (daily bid/offer/mid prices)

UploadBatch (tracks processing lifecycle)
└── FundTransaction
└── InvalidFundTransaction (validation failures)
```

## CSV File Format

Required columns:
- `transactionDate` (YYYY-MM-DD)
- `clientName`
- `fundCode` (XUMMF, XUBF, XUDEF, XUREF)
- `amount` (deposit/withdrawal amount)
- `units` (units issued/redeemed)
- `transactionType` (DEPOSIT, WITHDRAWAL, etc.)
- `bidPrice` (buy-back price)
- `offerPrice` (selling price)
- `midPrice` (average price)
- `dateCreated` (system creation date)
- `goalTitle`
- `goalNumber`
- `accountNumber`
- `accountType` (PERSONAL, CORPORATE, JOINT)
- `accountCategory` (GENERAL, RETIREMENT, EDUCATION)

## Development

### Running Tests
```bash
npm test
npm run test:watch
```

### Database Management
```bash
# Open Prisma Studio (database GUI)
npm run prisma:studio

# Create a new migration
npm run prisma:migrate

# Reset database (WARNING: deletes all data)
npx prisma migrate reset
```

### Linting and Formatting
```bash
npm run lint
npm run format
```

## Project Structure

```
xeno-reconciliation/
├── prisma/
│   ├── schema.prisma         # Database schema
│   ├── migrations/           # Migration history
│   └── seed.ts              # Seed data
├── src/
│   ├── config/              # Configuration (DB, queue, env)
│   ├── services/
│   │   ├── fund-upload/     # Upload processing logic
│   │   ├── reconciliation/  # Reconciliation services
│   │   └── reporting/       # Report generation
│   ├── routes/              # API endpoints
│   ├── middleware/          # Express middleware
│   ├── utils/               # Utilities
│   └── app.ts              # Application entry point
├── uploads/                 # Temporary file storage
└── tests/                   # Test suites
```

## Performance

- **Streaming CSV Parser**: Memory-efficient for large files
- **Batch Database Inserts**: 500-1000 records per transaction
- **Indexed Queries**: Fast lookups on goalTransactionCode, dates
- **Queue-Based Processing**: Non-blocking uploads, background processing

## License

ISC

## Support

For issues and questions, please contact the development team.
