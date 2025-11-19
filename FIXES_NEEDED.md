# Critical Fixes Needed

## Issue 1: Materialized View Not Auto-Refreshing

### Problem
- Upload completes successfully (489 fund transactions saved)
- Materialized view shows 0 goal transactions until manually refreshed
- The refresh code exists in `FundFileProcessor.ts:189-198` but doesn't execute

### Root Cause Analysis
The auto-refresh logic is in the `finalizeProcessing` method, but this may not be called in all code paths, especially during the approval workflow (resume-after-approval).

### Files to Check/Fix
1. `src/services/fund-upload/FundFileProcessor.ts` - Lines 189-198
   - Check if `finalizeProcessing` is called in resume path
   - Add logging to track when refresh is attempted

2. `src/services/fund-worker.ts` - The worker entry point
   - Check which method is called after approval

### Solution
Move the materialized view refresh to AFTER the entity creation step in `resumeProcessing()`, not just in `finalizeProcessing()`.

---

## Issue 2: Frontend Needs Seamless Polling & Modal Flow

### Current Behavior (BAD)
1. Upload starts
2. Shows "FAILED" initially
3. User manually refreshes → sees "COMPLETED"
4. User manually refreshes again → sees "WAITING_FOR_APPROVAL"
5. No automatic modal

### Desired Behavior (GOOD - Like GLUpload)
1. Upload starts
2. **Automatic polling** every 5 seconds (POLLING_INTERVAL)
3. Status changes from QUEUED → PROCESSING → WAITING_FOR_APPROVAL
4. **Modal automatically opens** showing new entities for approval
5. After approval → PROCESSING → COMPLETED
6. Goal transactions immediately visible

### Reference Implementation
See: `C:\Users\kiwan\OneDrive\PROJECTS\FinanceOS_System_V2_Build\financeos\packages\frontend\src\components\GLUpload.tsx`

Key patterns:
- **Lines 92-93**: `processingBatchId` state tracks active upload
- **Lines 129-208**: `useEffect` with polling interval
- **Lines 175-196**: Auto-opens modal when status becomes `waiting_for_approval`
- **Lines 150-166**: Handles completion elegantly

### Frontend Files to Update

`frontend/src/app/upload/page.tsx`:
1. Add polling state and interval (lines 129-208 from reference)
2. Add `processingBatchId` state
3. Add modal components for:
   - New entity approval
   - Validation errors/warnings
4. Auto-open modal when `newEntitiesStatus === 'PENDING'`

---

## Implementation Priority

### Priority 1: Fix Auto-Refresh (Backend)
**Impact**: High - Users can't see data after upload
**Effort**: Low - Just move 1 code block

Steps:
1. Check where `resumeProcessing` calls `finalizeProcessing`
2. Ensure materialized view refresh happens AFTER entity creation
3. Add comprehensive logging

### Priority 2: Add Frontend Polling (Frontend)
**Impact**: High - UX is broken, requires manual refresh
**Effort**: Medium - Copy pattern from GLUpload

Steps:
1. Add polling `useEffect` hook
2. Track `processingBatchId`
3. Auto-fetch status every 5s while processing

### Priority 3: Add Modal Flow (Frontend)
**Impact**: Medium - Approval process is clunky
**Effort**: Medium - Need modal components

Steps:
1. Create approval modal component
2. Auto-open when status becomes WAITING_FOR_APPROVAL
3. Handle approval submission
4. Resume polling after approval

---

## Quick Fix Commands

### Manual Refresh (Temporary)
```bash
node "C:\Users\kiwan\OneDrive\PROJECTS\XENO Reconciliation\scripts\refresh-materialized-view.js"
```

### Reset Data for Testing
```bash
node "C:\Users\kiwan\OneDrive\PROJECTS\XENO Reconciliation\scripts\reset-data.js"
```

---

## Testing Checklist
After fixes:
- [ ] Upload file → auto-refreshes view (126 transactions visible)
- [ ] Frontend polls automatically (no manual refresh needed)
- [ ] Modal auto-opens for new entities
- [ ] Approve entities → processing resumes
- [ ] Goal transactions appear immediately after completion
- [ ] No "FAILED" → "COMPLETED" status flicker

---

## Current Status
- ✅ 4 funds seeded (XUMMF, XUBF, XUDEF, XUREF)
- ✅ 489 fund transactions imported
- ✅ 126 goal transactions (after manual refresh)
- ❌ Auto-refresh not working
- ❌ Frontend polling not implemented
