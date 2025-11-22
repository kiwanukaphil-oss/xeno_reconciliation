# Batch Rollback Feature

## Overview
Added the ability to delete individual upload batches from the upload history without resetting the entire database.

## How It Works

### Backend Implementation

**BatchRollbackService** (`src/services/fund-upload/database/BatchRollbackService.ts`):
- Safely deletes a batch and all associated data
- Smart cleanup: Only deletes clients/accounts/goals that have no other transactions
- Prevents deletion of batches that are currently processing
- Automatically refreshes materialized view after rollback

**Deletion Order**:
1. Delete all fund transactions for the batch
2. Delete orphaned goals (goals with no remaining transactions)
3. Delete orphaned accounts (accounts with no remaining goals)
4. Delete orphaned clients (clients with no remaining accounts)
5. Delete invalid fund transactions
6. Delete the upload batch record
7. Refresh goal transactions materialized view

### API Endpoint

**DELETE** `/api/fund-upload/batches/:batchId/rollback`

**Response**:
```json
{
  "success": true,
  "message": "Batch BATCH-20251119-12345 rolled back successfully. Deleted: 489 transactions, 73 goals, 65 accounts, 63 clients",
  "deletedCounts": {
    "fundTransactions": 489,
    "goals": 73,
    "accounts": 65,
    "clients": 63
  }
}
```

### Frontend Implementation

**Location**: Upload History table in Fund Upload page

**UI Changes**:
- Added "Delete" button (with trash icon) next to "View Details" for COMPLETED and FAILED batches
- Button appears in red to indicate destructive action
- Confirmation dialog explains what will be deleted
- Success message shows detailed deletion counts

## Usage

### From Frontend
1. Navigate to Fund Upload page
2. Find the batch you want to delete in Upload History
3. Click the red "Delete" button next to "View Details"
4. Confirm the deletion in the dialog
5. View the success message with deletion details
6. The batch and all its data are removed

### From API
```bash
curl -X DELETE http://localhost:3000/api/fund-upload/batches/{batchId}/rollback
```

## Safety Features

1. **Processing Protection**: Cannot delete batches that are currently PARSING, VALIDATING, or PROCESSING
2. **Orphan Protection**: Only deletes entities (clients/accounts/goals) that have no other transactions
3. **Confirmation Required**: Frontend requires user confirmation before deletion
4. **Queue Cleanup**: Removes any pending jobs from the processing queue
5. **Materialized View Refresh**: Automatically updates the goal transactions view

## Use Cases

1. **Corrupted Uploads**: Delete a batch that failed with errors
2. **Test Data Cleanup**: Remove test uploads without affecting other data
3. **Duplicate Uploads**: Delete accidentally uploaded duplicate batches
4. **Selective Cleanup**: Remove specific batches while keeping others

## Example Scenarios

### Scenario 1: Delete a Failed Batch
```
Batch: BATCH-20251119-12345
Status: FAILED
Result: Deletes 100 invalid transactions, 0 goals, 0 accounts, 0 clients
(No valid entities were created, so only invalid transactions are removed)
```

### Scenario 2: Delete a Completed Batch
```
Batch: BATCH-20251119-67890
Status: COMPLETED
Result: Deletes 489 transactions, 73 goals, 65 accounts, 63 clients
(All entities created by this batch are removed)
```

### Scenario 3: Delete One of Multiple Batches for Same Client
```
Batch: BATCH-20251119-11111 (first upload for Client A)
Batch: BATCH-20251119-22222 (second upload for Client A)

Delete BATCH-20251119-11111:
Result: Deletes transactions from first batch only
        Client A, their accounts, and goals remain (used by second batch)
```

## Technical Details

### Database Operations
- Uses Prisma transactions for data integrity
- Cascade deletes are NOT used (explicit deletion for safety)
- Counts are tracked and returned to user

### Logging
- All operations are logged for audit trail
- Includes batch number, deletion counts, and timing
- Errors are logged with full stack traces

### Performance
- Efficient: Only checks entities related to the batch
- Batch operations where possible
- Materialized view refresh happens once at the end

## Testing

Current test batch available:
- Batch: BATCH-20251119-05795
- Status: COMPLETED
- Records: 489 transactions, 126 goal transactions

You can test the rollback feature by clicking the "Delete" button next to this batch in the Upload History.

---

*Last Updated: 2025-11-19*
