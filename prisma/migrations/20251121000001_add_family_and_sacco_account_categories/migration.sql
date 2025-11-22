-- Add FAMILY and SACCO to AccountCategory enum
ALTER TYPE "AccountCategory" ADD VALUE IF NOT EXISTS 'FAMILY';
ALTER TYPE "AccountCategory" ADD VALUE IF NOT EXISTS 'SACCO';
