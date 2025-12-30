-- Drop ReconciliationVariance table and related enums
DROP TABLE IF EXISTS "reconciliation_variances" CASCADE;

-- Drop the enums that were only used by ReconciliationVariance
DROP TYPE IF EXISTS "VarianceType" CASCADE;
DROP TYPE IF EXISTS "VarianceSeverity" CASCADE;
DROP TYPE IF EXISTS "VarianceResolutionStatus" CASCADE;
