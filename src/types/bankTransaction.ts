import { TransactionType } from '@prisma/client';

/**
 * Raw bank transaction row from CSV
 * Matches the format: Date,First Name,Last Name,Acc Number,Goal Name,Goal Number,
 * Total Amount,XUMMF,XUBF,XUDEF,XUREF,XUMMF,XUBF,XUDEF,XUREF,Transaction Type,Transaction ID
 */
export interface RawBankTransactionRow {
  Date: string;
  'First Name': string;
  'Last Name': string;
  'Acc Number': string;
  'Goal Name': string;
  'Goal Number': string;
  'Total Amount': string;
  // First set of fund columns (percentages as decimals)
  XUMMF: string;
  XUBF: string;
  XUDEF: string;
  XUREF: string;
  // Note: Second set of XUMMF, XUBF, XUDEF, XUREF in CSV are amounts
  // PapaParse will only capture first occurrence of duplicate headers
  // We'll need to handle this specially
  'Transaction Type': string;
  'Transaction ID': string;
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
  transactionType: TransactionType;
  transactionId: string;
  totalAmount: number;

  // Fund distribution percentages (as decimals, e.g., 0.4 for 40%)
  fundPercentages: {
    XUMMF: number;
    XUBF: number;
    XUDEF: number;
    XUREF: number;
  };

  // Fund distribution amounts
  fundAmounts: {
    XUMMF: number;
    XUBF: number;
    XUDEF: number;
    XUREF: number;
  };
}

/**
 * Bank transaction with resolved entity IDs
 */
export interface ValidatedBankTransaction extends ParsedBankTransaction {
  clientId: string;
  accountId: string;
  goalId: string;
}
