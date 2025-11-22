const { UnifiedFileParser } = require('../dist/services/fund-upload/parsers/UnifiedFileParser');
const { FundTransactionValidator } = require('../dist/services/fund-upload/validators/FundTransactionValidator');
const { GoalTransactionValidator } = require('../dist/services/fund-upload/validators/GoalTransactionValidator');

async function testFile() {
  try {
    const filePath = 'uploads/temp/2025_3 May - Ultima Fund Transactions.xlsx';

    console.log('Parsing file...');
    const transactions = await UnifiedFileParser.parseFile(filePath);
    console.log(`Parsed ${transactions.length} transactions`);

    console.log('\nValidating individual transactions...');
    const validationResult = FundTransactionValidator.validateBatch(transactions);
    console.log(`Valid: ${validationResult.validTransactions.length}`);
    console.log(`Invalid: ${validationResult.invalidTransactions.length}`);

    console.log('\nValidating goal transaction groups...');
    const groupErrors = GoalTransactionValidator.validateGoalTransactionGroups(validationResult.validTransactions);

    const criticalErrors = groupErrors.filter(e => e.severity === 'CRITICAL');
    console.log(`\nFound ${criticalErrors.length} CRITICAL errors:\n`);

    criticalErrors.forEach((error, index) => {
      console.log(`${index + 1}. Error Code: ${error.errorCode}`);
      console.log(`   Rows: ${JSON.stringify(error.value?.rows || [error.rowNumber])}`);
      console.log(`   Message: ${error.message}`);
      console.log(`   Suggested Action: ${error.suggestedAction}`);
      if (error.value) {
        console.log(`   Details: ${JSON.stringify(error.value, null, 2)}`);
      }
      console.log('');
    });

  } catch (error) {
    console.error('Error:', error.message);
    console.error(error.stack);
  }
}

testFile();
