-- Name-based gender estimates for accounts without a declared gender, plus a log of estimator runs.
ALTER TABLE "account_profiles"
  ADD COLUMN "estimatedGender" "Gender",
  ADD COLUMN "estimatedFemaleProbability" DOUBLE PRECISION,
  ADD COLUMN "genderEstimateModel" TEXT,
  ADD COLUMN "genderEstimatedAt" TIMESTAMP(3);

CREATE TABLE "gender_estimate_runs" (
  "id" TEXT NOT NULL,
  "modelVersion" TEXT NOT NULL,
  "runAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "confidenceThreshold" DOUBLE PRECISION NOT NULL,
  "labelledAccounts" INTEGER NOT NULL,
  "scoredAccounts" INTEGER NOT NULL,
  "labelledEstimates" INTEGER NOT NULL,
  "unscorableAccounts" INTEGER NOT NULL,
  "holdoutAccuracy" DOUBLE PRECISION NOT NULL,
  "holdoutCoverage" DOUBLE PRECISION NOT NULL,
  "mtnHoldoutAccuracy" DOUBLE PRECISION,
  "predictedFemaleShare" DOUBLE PRECISION NOT NULL,
  "actualFemaleShare" DOUBLE PRECISION NOT NULL,
  "metrics" JSONB NOT NULL,
  CONSTRAINT "gender_estimate_runs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "gender_estimate_runs_runAt_idx" ON "gender_estimate_runs"("runAt");
