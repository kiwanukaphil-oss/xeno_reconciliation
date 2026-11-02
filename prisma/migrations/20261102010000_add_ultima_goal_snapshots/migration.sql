-- Ultima Goal Stats snapshots (goal targets and Ultima-side values per as-of date)
-- CreateTable
CREATE TABLE "ultima_goal_snapshots" (
    "id" TEXT NOT NULL,
    "goalId" TEXT NOT NULL,
    "asOfDate" DATE NOT NULL,
    "goalTarget" DECIMAL(18,2),
    "currentValue" DECIMAL(18,2) NOT NULL,
    "netInvested" DECIMAL(18,2) NOT NULL,
    "lastDepositAmount" DECIMAL(18,2),
    "lastDepositDate" DATE,
    "depositCount" INTEGER NOT NULL,
    "withdrawalCount" INTEGER NOT NULL,
    "sourceFile" TEXT,
    "importedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ultima_goal_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ultima_goal_snapshots_asOfDate_idx" ON "ultima_goal_snapshots"("asOfDate");

-- CreateIndex
CREATE UNIQUE INDEX "ultima_goal_snapshots_goalId_asOfDate_key" ON "ultima_goal_snapshots"("goalId", "asOfDate");

-- AddForeignKey
ALTER TABLE "ultima_goal_snapshots" ADD CONSTRAINT "ultima_goal_snapshots_goalId_fkey" FOREIGN KEY ("goalId") REFERENCES "goals"("id") ON DELETE CASCADE ON UPDATE CASCADE;

