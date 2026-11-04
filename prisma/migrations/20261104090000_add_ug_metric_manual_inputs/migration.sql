-- Figures for the monthly XENO_Metrics Inputs-UG report that the system has no source for (USD/UGX,
-- financials, bank balances, visitors, autosaves), entered by hand once per month and metric.
CREATE TABLE "ug_metric_manual_inputs" (
    "month" DATE NOT NULL,
    "metricKey" TEXT NOT NULL,
    "value" DECIMAL(20,4) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ug_metric_manual_inputs_pkey" PRIMARY KEY ("month", "metricKey")
);
