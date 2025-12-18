/**
 * Raw bank transaction row from CSV
 * Matches the format: Date,First Name,Last Name,Acc Number,Goal Name,Goal Number,
 * Total Amount,XUMMF,XUBF,XUDEF,XUREF,XUMMF,XUBF,XUDEF,XUREF,Transaction Type,Transaction ID
 */
export interface RawBankTransactionRow {
  Date?: string;
  date?: string;
  'First Name'?: string;
  'first name'?: string;
  'Last Name'?: string;
  'last name'?: string;
  'Acc Number'?: string;
  'acc number'?: string;
  'Goal Name'?: string;
  'goal name'?: string;
  'Goal Number'?: string;
  'goal number'?: string;
  'Total Amount'?: string;
  'total amount'?: string;
  // Fund columns (may appear twice: percentages and amounts)
  XUMMF?: string;
  XUBF?: string;
  XUDEF?: string;
  XUREF?: string;
  'Transaction Type'?: string;
  'transaction type'?: string;
  'Transaction ID'?: string;
  'transaction id'?: string;
  // Allow any other columns
  [key: string]: string | undefined;
}

/**
 * Parsed bank transaction ready for validation and processing
 */
export interface ParsedBankTransaction {
  // Row metadata
  rowNumber: number;

  // Client information
  firstName: string;
  lastName: string;
  accountNumber: string;
  goalTitle: string;
  goalNumber: string;

  // Transaction details
  transactionDate: Date;
  transactionType: string;
  transactionId: string;
  totalAmount: number;

  // Fund distribution percentages (as whole numbers, e.g., 40 for 40%)
  xummfPercentage: number;
  xubfPercentage: number;
  xudefPercentage: number;
  xurefPercentage: number;

  // Fund distribution amounts
  xummfAmount: number;
  xubfAmount: number;
  xudefAmount: number;
  xurefAmount: number;
}

/**
 * Bank transaction with resolved entity IDs
 */
export interface ValidatedBankTransaction extends ParsedBankTransaction {
  clientId: string;
  accountId: string;
  goalId: string;
}

/**
 * Validation error for bank transactions
 */
export interface ValidationError {
  rowNumber: number;
  field: string;
  value: any;
  errorCode: string;
  message: string;
  severity: 'CRITICAL' | 'WARNING' | 'INFO';
  suggestedAction: string;
}

/**
 * Invalid bank transaction with errors
 */
export interface InvalidBankTransaction {
  transaction: ParsedBankTransaction;
  errors: ValidationError[];
}
