# XENO Reconciliation Frontend - File Generator Guide

## Status
✅ Configuration complete
✅ Dependencies installed (214 packages)
✅ Directory structure created
✅ Core utilities created (utils.ts, queryClient.ts)
✅ CSS with Tailwind configured

## Remaining Files Needed

The frontend follows the FinanceOS architecture pattern with:
- **shadcn/ui** style components
- **State-based navigation** (no React Router)
- **Fetch API** for HTTP requests
- **React Query** for server state
- **Polling** for real-time updates

### Critical Files to Create Next

Due to the large number of files, I recommend using one of these approaches:

**Option 1: Copy from FinanceOS Template**
Since the architecture is identical to FinanceOS, you can copy the following component patterns from FinanceOS and adapt them:

1. **UI Components** (`src/components/ui/`)
   - Copy from: `FinanceOS/packages/frontend/src/components/ui/*`
   - Files needed: button.tsx, dialog.tsx, card.tsx, progress.tsx, scroll-area.tsx

2. **Services** (`src/services/api.ts`)
   - Pattern from: `FinanceOS/packages/frontend/src/services/api.ts`
   - Adapt the fetch functions for XENO API endpoints

3. **Main App** (`src/App.tsx`)
   - Pattern from: `FinanceOS/packages/frontend/src/App.tsx`
   - Update modules array for XENO features (Fund Upload, Transactions, Approval, etc.)

**Option 2: Use Claude Code to Generate**
Ask Claude to generate each component file based on the FinanceOS patterns already reviewed.

**Option 3: Manual Creation**
Create files in this order:
1. UI components (Button, Dialog, Card, Progress)
2. Services/API layer
3. Main App shell with sidebar
4. Feature components (FundUpload, Dashboard, etc.)

## File Templates Available

I can provide templates for:
- ✅ UI Components (shadcn/ui style)
- ✅ API Service layer
- ✅ Main App with sidebar navigation
- ✅ Fund Upload with drag & drop
- ✅ Dashboard with cards
- ✅ Transaction tables
- ✅ Approval Queue

**Ready to proceed with generating the remaining files?**

Let me know which approach you prefer and I'll help create all the necessary files.
