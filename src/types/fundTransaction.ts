import { Decimal } from '@prisma/client/runtime/library';

// Raw CSV row data (as parsed from file)
export interface RawFundTransactionRow {
  fundTransactionId: string; // Unique transaction ID from source system
  transactionDate: string;
  clientName: string;
  fundCode: string;
  amount: string;
  units: string;
  transactionType: string;
  bidPrice: string;
  offerPrice: string;
  midPrice: string;
  dateCreated: string;
  goalTitle: string;
  goalNumber: string;
  accountNumber: string;
  accountType: string;
  accountCategory: string;
  sponsorCode?: string; // Optional: for group/employer sponsored accounts
}

// Parsed and typed transaction data
export interface ParsedFundTransaction {
  // Unique identifier from source system
  fundTransactionId: string;

  // Generated field
  goalTransactionCode: string;

  // Original fields (typed)
  transactionDate: Date;
  clientName: string;
  fundCode: string;
  amount: number;
  units: number;
  transactionType: string;
  bidPrice: number;
  offerPrice: number;
  midPrice: number;
  dateCreated: Date;
  goalTitle: string;
  goalNumber: string;
  accountNumber: string;
  accountType: string;
  accountCategory: string;
  sponsorCode?: string; // Optional: for group/employer sponsored accounts

  // Row tracking
  rowNumber: number;
}

// Validation error for a specific transaction
export interface TransactionValidationError {
  rowNumber: number;
  field?: string;
  errorCode: string;
  message: string;
  severity: 'CRITICAL' | 'WARNING' | 'INFO';
  suggestedAction?: string;
  value?: any;
}

// Validation result for a batch
export interface ValidationResult {
  isValid: boolean;
  validTransactions: ParsedFundTransaction[];
  invalidTransactions: {
    transaction: RawFundTransactionRow;
    rowNumber: number;
    errors: TransactionValidationError[];
  }[];
  warnings: TransactionValidationError[];
  summary: {
    totalRows: number;
    validRows: number;
    invalidRows: number;
    warningRows: number;
  };
}

// Goal transaction group (multiple fund transactions linked together)
export interface GoalTransactionGroup {
  goalTransactionCode: string;
  fundTransactions: ParsedFundTransaction[];
  transactionDate: Date;
  clientName: string;
  accountNumber: string;
  goalNumber: string;
  goalTitle: string;
  totalAmount: number;
  fundCount: number;
}

// New entities detected during processing
export interface NewEntitiesReport {
  clients: NewClientInfo[];
  accounts: NewAccountInfo[];
  goals: NewGoalInfo[];
}

export interface NewClientInfo {
  clientName: string;
  transactionCount: number;
  totalAmount: number;
}

export interface NewAccountInfo {
  accountNumber: string;
  accountType: string;
  accountCategory: string;
  sponsorCode?: string; // Optional: for group/employer sponsored accounts
  clientName: string;
  transactionCount: number;
  totalAmount: number;
}

export interface NewGoalInfo {
  goalNumber: string;
  goalTitle: string;
  accountNumber: string;
  clientName: string;
  transactionCount: number;
  totalAmount: number;
  fundDistribution: Record<string, number>; // Calculated from transactions
}

// Fund breakdown for batch summary
export interface FundBreakdownItem {
  fundCode: string;
  transactions: number;
  totalAmount: Decimal;
  totalUnits: Decimal;
  averagePrice: number;
}

export interface FundBreakdown {
  [fundCode: string]: FundBreakdownItem;
}
