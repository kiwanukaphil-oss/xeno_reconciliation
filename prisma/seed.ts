import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('Starting database seed...');

  // ============================================================================
  // SEED FUNDS
  // ============================================================================
  console.log('Seeding funds...');

  const funds = [
    {
      fundCode: 'XUMMF',
      fundName: 'Xeno Unit Money Market Fund',
      fundType: 'MONEY_MARKET' as const,
      currency: 'UGX',
      inceptionDate: new Date('2010-01-01'),
      status: 'ACTIVE' as const,
    },
    {
      fundCode: 'XUBF',
      fundName: 'Xeno Unit Bond Fund',
      fundType: 'BOND' as const,
      currency: 'UGX',
      inceptionDate: new Date('2012-06-01'),
      status: 'ACTIVE' as const,
    },
    {
      fundCode: 'XUDEF',
      fundName: 'Xeno Unit Domestic Equity Fund',
      fundType: 'EQUITY' as const,
      currency: 'UGX',
      inceptionDate: new Date('2015-03-15'),
      status: 'ACTIVE' as const,
    },
    {
      fundCode: 'XUREF',
      fundName: 'Xeno Unit Regional Equity Fund',
      fundType: 'EQUITY' as const,
      currency: 'UGX',
      inceptionDate: new Date('2016-09-01'),
      status: 'ACTIVE' as const,
    },
  ];

  for (const fund of funds) {
    await prisma.fund.upsert({
      where: { fundCode: fund.fundCode },
      update: fund,
      create: fund,
    });
    console.log(`  ✓ Fund created/updated: ${fund.fundCode} - ${fund.fundName}`);
  }

  // ============================================================================
  // SEED VALIDATION RULES
  // ============================================================================
  console.log('\nSeeding validation rules...');

  const validationRules = [
    // Required Field Rules
    {
      ruleName: 'REQUIRED_TRANSACTION_DATE',
      ruleType: 'REQUIRED_FIELD' as const,
      severity: 'CRITICAL' as const,
      configuration: { field: 'transactionDate' },
      errorMessage: 'Transaction date is required',
      suggestedAction: 'Ensure the transactionDate field is not empty',
    },
    {
      ruleName: 'REQUIRED_CLIENT_NAME',
      ruleType: 'REQUIRED_FIELD' as const,
      severity: 'CRITICAL' as const,
      configuration: { field: 'clientName' },
      errorMessage: 'Client name is required',
      suggestedAction: 'Ensure the clientName field is not empty',
    },
    {
      ruleName: 'REQUIRED_FUND_CODE',
      ruleType: 'REQUIRED_FIELD' as const,
      severity: 'CRITICAL' as const,
      configuration: { field: 'fundCode' },
      errorMessage: 'Fund code is required',
      suggestedAction: 'Ensure the fundCode field is not empty',
    },
    {
      ruleName: 'REQUIRED_AMOUNT',
      ruleType: 'REQUIRED_FIELD' as const,
      severity: 'CRITICAL' as const,
      configuration: { field: 'amount' },
      errorMessage: 'Transaction amount is required',
      suggestedAction: 'Ensure the amount field is not empty',
    },
    {
      ruleName: 'REQUIRED_UNITS',
      ruleType: 'REQUIRED_FIELD' as const,
      severity: 'CRITICAL' as const,
      configuration: { field: 'units' },
      errorMessage: 'Units are required',
      suggestedAction: 'Ensure the units field is not empty',
    },

    // Date Validation Rules
    {
      ruleName: 'DATE_FORMAT_VALID',
      ruleType: 'DATE_VALIDATION' as const,
      severity: 'CRITICAL' as const,
      configuration: {
        allowedFormats: ['YYYY-MM-DD', 'DD/MM/YYYY', 'MM/DD/YYYY']
      },
      errorMessage: 'Invalid date format',
      suggestedAction: 'Use format: YYYY-MM-DD, DD/MM/YYYY, or MM/DD/YYYY',
    },
    {
      ruleName: 'DATE_NOT_FUTURE',
      ruleType: 'DATE_VALIDATION' as const,
      severity: 'CRITICAL' as const,
      configuration: { maxFutureYears: 0 },
      errorMessage: 'Transaction date cannot be in the future',
      suggestedAction: 'Ensure transaction date is today or in the past',
    },
    {
      ruleName: 'DATE_WITHIN_RANGE',
      ruleType: 'DATE_VALIDATION' as const,
      severity: 'WARNING' as const,
      configuration: {
        minPastYears: 10,
        maxFutureYears: 0
      },
      errorMessage: 'Transaction date is outside acceptable range',
      suggestedAction: 'Transaction date should be within the last 10 years',
    },

    // Amount Validation Rules
    {
      ruleName: 'AMOUNT_POSITIVE',
      ruleType: 'AMOUNT_VALIDATION' as const,
      severity: 'CRITICAL' as const,
      configuration: { minValue: 0.01 },
      errorMessage: 'Amount must be greater than zero',
      suggestedAction: 'Ensure amount is a positive number',
    },
    {
      ruleName: 'AMOUNT_WITHIN_LIMITS',
      ruleType: 'AMOUNT_VALIDATION' as const,
      severity: 'WARNING' as const,
      configuration: {
        minValue: 1000,
        maxValue: 1000000000
      },
      errorMessage: 'Amount is outside normal limits',
      suggestedAction: 'Verify amount is between 1,000 and 1,000,000,000',
    },

    // Units Validation Rules
    {
      ruleName: 'UNITS_POSITIVE',
      ruleType: 'UNITS_VALIDATION' as const,
      severity: 'CRITICAL' as const,
      configuration: { minValue: 0.000001 },
      errorMessage: 'Units must be greater than zero',
      suggestedAction: 'Ensure units is a positive number',
    },
    {
      ruleName: 'UNITS_CALCULATION_VALID',
      ruleType: 'UNITS_VALIDATION' as const,
      severity: 'CRITICAL' as const,
      configuration: {
        tolerance: 0.01,
        formula: 'units = amount / offerPrice (for deposits)'
      },
      errorMessage: 'Unit calculation does not match expected formula',
      suggestedAction: 'Verify: units = amount / offerPrice (±0.01 tolerance)',
    },

    // Price Validation Rules
    {
      ruleName: 'PRICES_POSITIVE',
      ruleType: 'PRICE_VALIDATION' as const,
      severity: 'CRITICAL' as const,
      configuration: { minValue: 0.01 },
      errorMessage: 'All prices must be greater than zero',
      suggestedAction: 'Ensure bidPrice, offerPrice, and midPrice are positive',
    },
    {
      ruleName: 'PRICE_RELATIONSHIP_VALID',
      ruleType: 'PRICE_VALIDATION' as const,
      severity: 'CRITICAL' as const,
      configuration: {
        rule: 'bidPrice <= midPrice <= offerPrice'
      },
      errorMessage: 'Price relationship is invalid',
      suggestedAction: 'Ensure bidPrice ≤ midPrice ≤ offerPrice',
    },
    {
      ruleName: 'PRICE_VARIANCE_CHECK',
      ruleType: 'PRICE_VALIDATION' as const,
      severity: 'WARNING' as const,
      configuration: {
        maxDailyVariance: 0.10 // 10%
      },
      errorMessage: 'Price variance exceeds 10% from previous day',
      suggestedAction: 'Review price for potential data entry error',
    },

    // Business Rules
    {
      ruleName: 'FUND_CODE_VALID',
      ruleType: 'BUSINESS_RULE' as const,
      severity: 'CRITICAL' as const,
      configuration: {
        allowedValues: ['XUMMF', 'XUBF', 'XUDEF', 'XUREF']
      },
      errorMessage: 'Invalid fund code',
      suggestedAction: 'Fund code must be one of: XUMMF, XUBF, XUDEF, XUREF',
    },
    {
      ruleName: 'ACCOUNT_NUMBER_FORMAT',
      ruleType: 'BUSINESS_RULE' as const,
      severity: 'CRITICAL' as const,
      configuration: {
        pattern: '^\\d{3}-\\d{9,}$',
        description: 'XXX-XXXXXXXXX format'
      },
      errorMessage: 'Invalid account number format',
      suggestedAction: 'Account number should be in format: XXX-XXXXXXXXX',
    },
    {
      ruleName: 'GOAL_NUMBER_FORMAT',
      ruleType: 'BUSINESS_RULE' as const,
      severity: 'CRITICAL' as const,
      configuration: {
        pattern: '^\\d{3}-\\d{9,}[a-z]$',
        description: 'Account number + suffix'
      },
      errorMessage: 'Invalid goal number format',
      suggestedAction: 'Goal number should be account number with a letter suffix',
    },

    // Goal Transaction Consistency Rules
    {
      ruleName: 'GOAL_TRANSACTION_SAME_CLIENT',
      ruleType: 'GOAL_TRANSACTION_CONSISTENCY' as const,
      severity: 'CRITICAL' as const,
      configuration: {},
      errorMessage: 'All fund transactions in a goal transaction must have the same client',
      suggestedAction: 'Review transactions with same date, account, and goal',
    },
    {
      ruleName: 'GOAL_TRANSACTION_SAME_DATE',
      ruleType: 'GOAL_TRANSACTION_CONSISTENCY' as const,
      severity: 'CRITICAL' as const,
      configuration: {},
      errorMessage: 'All fund transactions in a goal transaction must have the same date',
      suggestedAction: 'Verify transaction dates match for related transactions',
    },
    {
      ruleName: 'GOAL_TRANSACTION_COMPLETE_FUND_SET',
      ruleType: 'GOAL_TRANSACTION_CONSISTENCY' as const,
      severity: 'WARNING' as const,
      configuration: {
        expectedFundCount: 4,
        expectedFunds: ['XUMMF', 'XUBF', 'XUDEF', 'XUREF']
      },
      errorMessage: 'Goal transaction does not have all 4 expected funds',
      suggestedAction: 'Verify all funds are present: XUMMF, XUBF, XUDEF, XUREF',
    },
    {
      ruleName: 'GOAL_TRANSACTION_NO_DUPLICATE_FUNDS',
      ruleType: 'GOAL_TRANSACTION_CONSISTENCY' as const,
      severity: 'CRITICAL' as const,
      configuration: {},
      errorMessage: 'Goal transaction has duplicate fund codes',
      suggestedAction: 'Each fund should appear only once per goal transaction',
    },

    // Fund Distribution Rules
    {
      ruleName: 'FUND_DISTRIBUTION_MATCHES_GOAL',
      ruleType: 'FUND_DISTRIBUTION' as const,
      severity: 'WARNING' as const,
      configuration: {
        tolerance: 0.01 // 1% tolerance
      },
      errorMessage: 'Fund amounts do not match goal distribution percentages',
      suggestedAction: 'Verify fund amounts match expected distribution (±1% tolerance)',
    },
  ];

  for (const rule of validationRules) {
    await prisma.validationRule.upsert({
      where: { ruleName: rule.ruleName },
      update: rule,
      create: rule,
    });
    console.log(`  ✓ Validation rule created/updated: ${rule.ruleName}`);
  }

  // ============================================================================
  // SEED SAMPLE FUND PRICES (Last 7 days)
  // ============================================================================
  console.log('\nSeeding sample fund prices...');

  const today = new Date();
  const fundPrices = [
    // XUMMF - Money Market (stable prices)
    { fundCode: 'XUMMF', bidPrice: 99.50, offerPrice: 100.00, midPrice: 99.75, nav: 100.00 },
    // XUBF - Bond Fund
    { fundCode: 'XUBF', bidPrice: 111.68, offerPrice: 111.80, midPrice: 111.74, nav: 111.91 },
    // XUDEF - Domestic Equity
    { fundCode: 'XUDEF', bidPrice: 145.20, offerPrice: 145.50, midPrice: 145.35, nav: 145.60 },
    // XUREF - Regional Equity
    { fundCode: 'XUREF', bidPrice: 178.90, offerPrice: 179.30, midPrice: 179.10, nav: 179.50 },
  ];

  for (let i = 0; i < 7; i++) {
    const priceDate = new Date(today);
    priceDate.setDate(today.getDate() - i);

    for (const price of fundPrices) {
      const fund = await prisma.fund.findUnique({
        where: { fundCode: price.fundCode },
      });

      if (fund) {
        // Add slight variation for historical prices (±0.5%)
        const variance = 1 + (Math.random() - 0.5) * 0.01;

        await prisma.fundPrice.upsert({
          where: {
            fundId_priceDate: {
              fundId: fund.id,
              priceDate,
            },
          },
          update: {},
          create: {
            fundId: fund.id,
            priceDate,
            bidPrice: price.bidPrice * variance,
            offerPrice: price.offerPrice * variance,
            midPrice: price.midPrice * variance,
            nav: price.nav ? price.nav * variance : null,
          },
        });
      }
    }
  }
  console.log('  ✓ Fund prices created for last 7 days');

  console.log('\n✅ Database seed completed successfully!');
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (e) => {
    console.error('❌ Seed failed:', e);
    await prisma.$disconnect();
    process.exit(1);
  });
