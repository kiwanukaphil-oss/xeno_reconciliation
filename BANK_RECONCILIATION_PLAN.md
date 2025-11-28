# Bank Reconciliation System - Implementation Plan

## Overview
Reconciliation system to compare fund system transactions (Team A) with bank transactions (Team B), identifying and managing variances in amounts, fund distribution, and timing.

---

## 1. Database Schema Design

### New Tables to Add

```prisma
// ============================================================================
// BANK RECONCILIATION
// ============================================================================

model BankUploadBatch {
  id                  String   @id @default(uuid())
  batchNumber         String   @unique
  fileName            String
  fileSize            Int
  filePath            String

  // Processing
  processingStatus    BatchProcessingStatus @default(QUEUED)
  totalRecords        Int      @default(0)
  processedRecords    Int      @default(0)
  matchedRecords      Int      @default(0)
  varianceRecords     Int      @default(0)

  // Period covered
  periodStart         DateTime?
  periodEnd           DateTime?

  // Timestamps
  uploadedAt          DateTime @default(now())
  uploadedBy          String?
  processingStartedAt DateTime?
  processingCompletedAt DateTime?

  // Relations
  bankTransactions    BankGoalTransaction[]

  @@index([uploadedAt])
  @@index([processingStatus])
  @@map("bank_upload_batches")
}

model BankGoalTransaction {
  id                    String   @id @default(uuid())

  // Linking & Identification
  transactionDate       DateTime
  transactionId         String   // From bank (e.g., S19292983/02-01-2025/1)
  transactionType       TransactionType

  // Client & Account Info (from bank file)
  clientFirstName       String
  clientLastName        String
  accountNumber         String
  goalName              String
  goalNumber            String

  // Linked entities (after matching)
  clientId              String?
  accountId             String?
  goalId                String?

  // Amounts
  totalAmount           Decimal

  // Fund Distribution (percentages from bank)
  xummfPercentage       Decimal  @default(0)
  xubfPercentage        Decimal  @default(0)
  xudefPercentage       Decimal  @default(0)
  xurefPercentage       Decimal  @default(0)

  // Fund Amounts (actual from bank)
  xummfAmount           Decimal  @default(0)
  xubfAmount            Decimal  @default(0)
  xudefAmount           Decimal  @default(0)
  xurefAmount           Decimal  @default(0)

  // Reconciliation
  reconciliationStatus  ReconciliationStatus @default(PENDING)
  matchedGoalTransactionCode String? // Matched fund system goal transaction
  matchingScore         Decimal? // 0-100 score

  // Auto-approval
  autoApproved          Boolean  @default(false)
  autoApprovalReason    String?

  // Upload tracking
  uploadBatchId         String
  rowNumber             Int      // Row in CSV for error reporting

  // Timestamps
  createdAt             DateTime @default(now())
  reviewedAt            DateTime?
  reviewedBy            String?

  // Relations
  client                Client?  @relation(fields: [clientId], references: [id])
  account               Account? @relation(fields: [accountId], references: [id])
  goal                  Goal?    @relation(fields: [goalId], references: [id])
  uploadBatch           BankUploadBatch @relation(fields: [uploadBatchId], references: [id], onDelete: Cascade)
  variances             ReconciliationVariance[]

  @@index([transactionId])
  @@index([goalNumber])
  @@index([transactionDate])
  @@index([reconciliationStatus])
  @@index([uploadBatchId])
  @@map("bank_goal_transactions")
}

model ReconciliationVariance {
  id                        String @id @default(uuid())

  // Linked transactions
  bankGoalTransactionId     String
  fundGoalTransactionCode   String

  // Variance details
  varianceType              VarianceType
  severity                  VarianceSeverity @default(LOW)

  // Amount variances
  fundSystemTotalAmount     Decimal?
  bankTotalAmount           Decimal?
  amountDifference          Decimal?
  amountDifferencePercent   Decimal?

  // Date variance
  fundSystemDate            DateTime?
  bankDate                  DateTime?
  dateDifferenceDays        Int?

  // Fund-specific variances
  fundCode                  String?
  fundSystemFundAmount      Decimal?
  bankFundAmount            Decimal?
  fundDifference            Decimal?
  fundDifferencePercent     Decimal?

  // Resolution
  status                    VarianceResolutionStatus @default(PENDING)
  autoApproved              Boolean  @default(false)
  reviewedBy                String?
  reviewedAt                DateTime?
  resolutionNotes           String?

  // Relations
  bankGoalTransaction       BankGoalTransaction @relation(fields: [bankGoalTransactionId], references: [id], onDelete: Cascade)

  createdAt                 DateTime @default(now())

  @@index([varianceType])
  @@index([severity])
  @@index([status])
  @@map("reconciliation_variances")
}

// ============================================================================
// ENUMS
// ============================================================================

enum ReconciliationStatus {
  PENDING              // Not yet reconciled
  MATCHED              // Perfect match
  MATCHED_WITH_VARIANCE // Matched but has variances
  AUTO_APPROVED        // Auto-approved variance
  MANUAL_REVIEW        // Needs manual review
  MISSING_IN_FUND      // Exists in bank but not in fund system
  APPROVED             // Manually approved
  REJECTED             // Rejected/disputed
}

enum VarianceType {
  TOTAL_AMOUNT_MISMATCH
  FUND_DISTRIBUTION_MISMATCH
  DATE_MISMATCH
  MISSING_IN_BANK
  MISSING_IN_FUND_SYSTEM
}

enum VarianceSeverity {
  LOW      // Within tolerance, auto-approved
  MEDIUM   // Outside tolerance but small amount
  HIGH     // Large variance, needs review
  CRITICAL // Very large variance
}

enum VarianceResolutionStatus {
  PENDING
  AUTO_APPROVED
  APPROVED
  REJECTED
  INVESTIGATING
}

enum TransactionType {
  DEPOSIT
  WITHDRAWAL
}
```

---

## 2. Matching Algorithm

### Primary Matching Strategy
```typescript
/**
 * Match bank transaction to fund system goal transaction
 * Priority: Goal Number + Transaction ID + Total Amount
 */
interface MatchCriteria {
  // EXACT MATCH (100 points)
  goalNumber: string;        // Must match exactly
  transactionId: string;     // Must match exactly

  // AMOUNT MATCH (with tolerance)
  totalAmount: number;       // Within ±1% or ±1000 UGX (whichever is larger)

  // DATE MATCH (with tolerance)
  transactionDate: Date;     // Within ±4 days
}

// Matching Algorithm
function matchBankToFundTransaction(
  bankTxn: BankGoalTransaction
): {
  matched: boolean;
  fundGoalTransactionCode: string | null;
  score: number; // 0-100
  variances: Variance[];
} {

  // Step 1: Find fund transactions by goal number
  const fundTransactions = getFundTransactionsByGoalNumber(bankTxn.goalNumber);

  if (fundTransactions.length === 0) {
    return {
      matched: false,
      fundGoalTransactionCode: null,
      score: 0,
      variances: [{
        type: 'MISSING_IN_FUND_SYSTEM',
        severity: 'HIGH'
      }]
    };
  }

  // Step 2: Group by goal transaction code and filter by transaction ID
  const goalTransactionGroups = groupByGoalTransactionCode(fundTransactions);
  const matchingGroups = goalTransactionGroups.filter(group =>
    extractTransactionId(group.code) === bankTxn.transactionId
  );

  if (matchingGroups.length === 0) {
    return {
      matched: false,
      fundGoalTransactionCode: null,
      score: 0,
      variances: [{
        type: 'MISSING_IN_FUND_SYSTEM',
        severity: 'HIGH',
        message: `Goal ${bankTxn.goalNumber} exists but transaction ID ${bankTxn.transactionId} not found`
      }]
    };
  }

  // Step 3: Calculate amounts and compare
  const fundGroup = matchingGroups[0]; // Should only be one
  const fundTotalAmount = calculateTotalAmount(fundGroup);
  const fundAmounts = calculateFundAmounts(fundGroup);

  // Step 4: Detect variances
  const variances = detectVariances(bankTxn, fundGroup, fundTotalAmount, fundAmounts);

  // Step 5: Calculate match score
  const score = calculateMatchScore(variances);

  return {
    matched: true,
    fundGoalTransactionCode: fundGroup.code,
    score,
    variances
  };
}
```

### Variance Detection Logic
```typescript
function detectVariances(
  bankTxn: BankGoalTransaction,
  fundGroup: FundGoalTransactionGroup,
  fundTotalAmount: number,
  fundAmounts: FundAmounts
): Variance[] {
  const variances: Variance[] = [];
  const tolerance = {
    amountPercent: 0.01, // 1%
    amountAbsolute: 1000, // 1000 UGX
    dateDays: 4,
    fundDistributionPercent: 0.01 // 1%
  };

  // 1. Total Amount Variance
  const amountDiff = Math.abs(bankTxn.totalAmount - fundTotalAmount);
  const amountDiffPercent = amountDiff / Math.abs(fundTotalAmount);
  const amountThreshold = Math.max(
    Math.abs(fundTotalAmount) * tolerance.amountPercent,
    tolerance.amountAbsolute
  );

  if (amountDiff > amountThreshold) {
    variances.push({
      type: 'TOTAL_AMOUNT_MISMATCH',
      severity: calculateSeverity(amountDiff),
      fundSystemTotalAmount: fundTotalAmount,
      bankTotalAmount: bankTxn.totalAmount,
      amountDifference: amountDiff,
      amountDifferencePercent: amountDiffPercent * 100
    });
  }

  // 2. Date Variance
  const dateDiff = Math.abs(
    differenceInDays(bankTxn.transactionDate, fundGroup.transactionDate)
  );

  if (dateDiff > tolerance.dateDays) {
    variances.push({
      type: 'DATE_MISMATCH',
      severity: 'LOW', // Date variance is usually acceptable
      fundSystemDate: fundGroup.transactionDate,
      bankDate: bankTxn.transactionDate,
      dateDifferenceDays: dateDiff
    });
  }

  // 3. Fund Distribution Variance
  const funds = ['XUMMF', 'XUBF', 'XUDEF', 'XUREF'];

  for (const fund of funds) {
    const bankAmount = bankTxn[`${fund.toLowerCase()}Amount`];
    const fundAmount = fundAmounts[fund];
    const fundDiff = Math.abs(bankAmount - fundAmount);
    const fundDiffPercent = Math.abs(fundAmount) > 0
      ? fundDiff / Math.abs(fundAmount)
      : 0;

    if (fundDiffPercent > tolerance.fundDistributionPercent) {
      variances.push({
        type: 'FUND_DISTRIBUTION_MISMATCH',
        severity: calculateSeverity(fundDiff),
        fundCode: fund,
        fundSystemFundAmount: fundAmount,
        bankFundAmount: bankAmount,
        fundDifference: fundDiff,
        fundDifferencePercent: fundDiffPercent * 100
      });
    }
  }

  return variances;
}

function calculateSeverity(amountDiff: number): VarianceSeverity {
  const absAmountDiff = Math.abs(amountDiff);

  if (absAmountDiff < 1000) return 'LOW';
  if (absAmountDiff < 10000) return 'MEDIUM';
  if (absAmountDiff < 50000) return 'HIGH';
  return 'CRITICAL';
}
```

### Auto-Approval Logic
```typescript
function shouldAutoApprove(variances: Variance[]): {
  approved: boolean;
  reason: string;
} {
  // No variances = perfect match = auto-approve
  if (variances.length === 0) {
    return { approved: true, reason: 'Perfect match' };
  }

  // Check if all variances are within acceptable tolerance
  const hasHighVariance = variances.some(v =>
    v.severity === 'HIGH' || v.severity === 'CRITICAL'
  );

  if (hasHighVariance) {
    return { approved: false, reason: 'High severity variance detected' };
  }

  // Check variance types
  const varianceTypes = new Set(variances.map(v => v.type));

  // Date variance alone is acceptable
  if (varianceTypes.size === 1 && varianceTypes.has('DATE_MISMATCH')) {
    return { approved: true, reason: 'Date variance only (within ±4 days)' };
  }

  // Low severity fund distribution variance is acceptable
  const allLowSeverity = variances.every(v => v.severity === 'LOW');
  if (allLowSeverity) {
    return { approved: true, reason: 'All variances within acceptable tolerance' };
  }

  return { approved: false, reason: 'Variances require manual review' };
}
```

---

## 3. Upload & Processing Pipeline

### Phase 1: Upload
```typescript
POST /api/reconciliation/bank-upload

1. Validate file (CSV, max 100MB)
2. Create BankUploadBatch (status: QUEUED)
3. Enqueue job: "process-bank-reconciliation"
4. Return 202 Accepted with batch ID
```

### Phase 2: Background Processing
```typescript
async function processBankReconciliation(batchId: string) {
  // 1. Parse CSV
  const bankTransactions = await parseBankCSV(filePath);

  // 2. Validate each record
  const validatedRecords = await validateBankTransactions(bankTransactions);

  // 3. Link to existing clients/accounts/goals
  await linkToExistingEntities(validatedRecords);

  // 4. Auto-match with fund system
  for (const bankTxn of validatedRecords) {
    const matchResult = await matchBankToFundTransaction(bankTxn);

    bankTxn.reconciliationStatus = matchResult.matched
      ? 'MATCHED_WITH_VARIANCE'
      : 'MISSING_IN_FUND';
    bankTxn.matchedGoalTransactionCode = matchResult.fundGoalTransactionCode;
    bankTxn.matchingScore = matchResult.score;

    // Save variances
    for (const variance of matchResult.variances) {
      await createVariance(bankTxn.id, variance);
    }

    // Auto-approve if eligible
    const autoApproval = shouldAutoApprove(matchResult.variances);
    if (autoApproval.approved) {
      bankTxn.autoApproved = true;
      bankTxn.autoApprovalReason = autoApproval.reason;
      bankTxn.reconciliationStatus = 'AUTO_APPROVED';

      // Update variances to auto-approved
      await approveVariances(bankTxn.id);
    }
  }

  // 5. Save to database
  await saveBankTransactions(validatedRecords);

  // 6. Update batch summary
  await updateBatchSummary(batchId);

  // 7. Identify missing fund transactions (in fund but not in bank)
  await identifyMissingFundTransactions(batchId);
}
```

---

## 4. Key Services

### BankReconciliationService
```typescript
export class BankReconciliationService {
  // Upload & Processing
  static async uploadBankTransactions(file: File, uploadedBy: string);
  static async processBatch(batchId: string);

  // Matching
  static async autoMatchTransactions(batchId: string);
  static async manualMatch(bankTxnId: string, fundGoalTransactionCode: string);

  // Variance Management
  static async getVariances(filters: VarianceFilters);
  static async approveVariance(varianceId: string, approvedBy: string, notes?: string);
  static async rejectVariance(varianceId: string, rejectedBy: string, notes: string);

  // Reports
  static async getReconciliationSummary(period: DateRange);
  static async getMissingTransactions(type: 'BANK' | 'FUND' | 'BOTH');
  static async exportVarianceReport(filters: VarianceFilters);
}
```

### BankCSVParser
```typescript
export class BankCSVParser {
  static async parse(filePath: string): Promise<BankGoalTransaction[]> {
    // Parse CSV columns:
    // Date, First Name, Last Name, Acc Number, Goal Name, Goal Number,
    // Total Amount, XUMMF%, XUBF%, XUDEF%, XUREF%,
    // XUMMF Amt, XUBF Amt, XUDEF Amt, XUREF Amt,
    // Transaction Type, Transaction ID
  }

  static parseDate(dateStr: string): Date {
    // Handle format: "2-Jan-25"
  }

  static validateRow(row: any, rowNumber: number): ValidationResult;
}
```

---

## 5. API Endpoints

```typescript
// Upload & Batch Management
POST   /api/reconciliation/bank-upload
GET    /api/reconciliation/batches
GET    /api/reconciliation/batches/:batchId
GET    /api/reconciliation/batches/:batchId/summary

// Transactions
GET    /api/reconciliation/bank-transactions
GET    /api/reconciliation/bank-transactions/:id
POST   /api/reconciliation/manual-match

// Variances
GET    /api/reconciliation/variances
GET    /api/reconciliation/variances/:id
POST   /api/reconciliation/variances/:id/approve
POST   /api/reconciliation/variances/:id/reject

// Reports
GET    /api/reconciliation/summary
GET    /api/reconciliation/missing-transactions
GET    /api/reconciliation/variance-report/export
GET    /api/reconciliation/comparison/:goalTransactionCode
```

---

## 6. Frontend Components

### Reconciliation Dashboard
```
┌──────────────────────────────────────────────────────┐
│ Bank Reconciliation Dashboard                        │
├──────────────────────────────────────────────────────┤
│ Period: Jan 2024 ▼                                   │
│                                                       │
│ ┌────────────┐ ┌────────────┐ ┌──────────────┐     │
│ │ ✓ Matched  │ │ ⚠ Variance │ │ ✗ Missing    │     │
│ │    850     │ │     45     │ │      12      │     │
│ │   (93%)    │ │    (5%)    │ │     (2%)     │     │
│ └────────────┘ └────────────┘ └──────────────┘     │
│                                                       │
│ Auto-Approved: 820 | Manual Review: 30              │
│                                                       │
│ [Upload Bank Transactions] [Export Report]          │
└──────────────────────────────────────────────────────┘

Filters: Status ▼ | Severity ▼ | Date Range
[Show All] [Pending Only] [High Variance]
```

### Variance Investigation View
```
Transaction Comparison
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Bank Transaction                Fund System
────────────────────           ──────────────────
ID: S19292983/02-01-2025/1     Code: 2025-01-02-701-807...
Date: 2025-01-02 ⚠            Date: 2025-01-04 (+2 days)
Goal: 701-8076522785a  ✓       Goal: 701-8076522785a

Total: -145,206 ⚠              Total: -145,000 (±206)

Fund Distribution:
  XUMMF:  -36,085  (24.9%) ⚠    -36,250  (25.0%)
  XUBF:  -109,121  (75.1%) ⚠   -108,750  (75.0%)
  XUDEF:        0  (0.0%)  ✓           0  (0.0%)
  XUREF:        0  (0.0%)  ✓           0  (0.0%)

Variances:
• Amount: ±206 UGX (0.14%) - AUTO-APPROVED
• Distribution: XUMMF ±0.1%, XUBF ±0.1% - AUTO-APPROVED
• Date: +2 days - ACCEPTABLE

Status: AUTO-APPROVED ✓
Reason: All variances within acceptable tolerance

[View Details] [Override] [Add Notes]
```

---

## 7. Implementation Steps

### Phase 1: Database & Core Logic (Week 1)
- [ ] Add bank reconciliation tables to Prisma schema
- [ ] Run migrations
- [ ] Create BankCSVParser service
- [ ] Implement matching algorithm
- [ ] Implement variance detection logic
- [ ] Implement auto-approval logic

### Phase 2: Upload & Processing (Week 2)
- [ ] Create upload API endpoint
- [ ] Implement batch processing worker
- [ ] Create BankReconciliationService
- [ ] Add validation rules
- [ ] Implement entity linking (client/account/goal)

### Phase 3: Variance Management (Week 3)
- [ ] Create variance API endpoints
- [ ] Implement manual match functionality
- [ ] Add approval/rejection workflows
- [ ] Create variance reports

### Phase 4: Frontend (Week 4)
- [ ] Build reconciliation dashboard
- [ ] Create upload interface
- [ ] Build variance investigation screen
- [ ] Add missing transactions view
- [ ] Implement export functionality

### Phase 5: Testing & Historical Data (Week 5)
- [ ] Test with sample data
- [ ] Import historical bank transactions
- [ ] Run full reconciliation
- [ ] Review and approve variances
- [ ] Generate reconciliation reports

---

## 8. Sample Reconciliation Report

```
Bank Reconciliation Report
Period: January 2024
Generated: 2025-11-28

Summary
───────────────────────────────────────
Total Bank Transactions:        1,247
Matched (Perfect):                950 (76.2%)
Matched (With Variance):           45 (3.6%)
Auto-Approved:                    820 (65.8%)
Pending Review:                    30 (2.4%)
Missing in Fund System:            12 (1.0%)
Missing in Bank:                  210 (16.8%)

Variance Breakdown
───────────────────────────────────────
Amount Variances:                  35
  - Low Severity:                  30
  - Medium Severity:                5
  - High Severity:                  0

Distribution Variances:            28
  - Within 1%:                     28

Date Variances:                   142
  - Within ±4 days:               142

Top 10 Variances by Amount
───────────────────────────────────────
1. Goal 701-5558635 | ±5,250 UGX | STATUS: Approved
2. Goal 751-2552344 | ±3,100 UGX | STATUS: Pending
3. Goal 801-9876543 | ±2,890 UGX | STATUS: Approved
...

Actions Required
───────────────────────────────────────
• Review 30 pending variances
• Investigate 12 missing fund transactions
• Follow up on 210 missing bank transactions
```

---

## Questions for Confirmation

1. **Amount Tolerance**: Should we use ±1% OR ±1000 UGX (whichever is larger)?
2. **Critical Threshold**: What amount difference should flag as CRITICAL?
3. **Missing Transactions**: How should we handle transactions that exist in fund system but not in bank? Generate report for Team B?
4. **Withdrawal Handling**: Negative amounts in bank file - should these be automatically matched with negative units in fund system?
5. **Batch Period**: Should we validate that all transactions in a batch fall within a specific period (e.g., one week)?

Should we proceed with implementing this design?
