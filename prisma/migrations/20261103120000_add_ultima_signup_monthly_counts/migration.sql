-- Ultima sign-ups per month and channel, counted from Client Data exports (counts only, no per-person data).
-- Feeds "Registered" and "New Registered" of the monthly XENO_Metrics Inputs-UG report.
CREATE TABLE "ultima_signup_monthly_counts" (
    "month" DATE NOT NULL,
    "channel" TEXT NOT NULL,
    "newAccounts" INTEGER NOT NULL,
    "newUsers" INTEGER NOT NULL,
    "importedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ultima_signup_monthly_counts_pkey" PRIMARY KEY ("month", "channel")
);
