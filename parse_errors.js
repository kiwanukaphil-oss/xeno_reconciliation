const fs = require('fs');

const data = JSON.parse(fs.readFileSync('batch_summary.json', 'utf-8'));

console.log('=== UPLOAD BATCH SUMMARY ===');
console.log(`Batch: ${data.batchNumber}`);
console.log(`File: ${data.fileName}`);
console.log(`Status: ${data.processingStatus} / ${data.validationStatus}`);
console.log(`Total Records: ${data.totalRecords}`);
console.log(`Processed: ${data.processedRecords}`);
console.log(`Failed: ${data.failedRecords}`);
console.log('\n=== VALIDATION ERROR ===');
console.log(JSON.stringify(data.validationErrors, null, 2));

console.log('\n=== CRITICAL ERRORS ===');
const criticalErrors = data.validationWarnings?.filter(e => e.severity === 'CRITICAL') || [];
console.log(`Found ${criticalErrors.length} CRITICAL errors:\n`);

criticalErrors.forEach((error, index) => {
  console.log(`${index + 1}. Row ${error.rowNumber}: ${error.errorCode}`);
  console.log(`   Message: ${error.message}`);
  console.log(`   Action: ${error.suggestedAction}`);
  if (error.value) {
    console.log(`   Value: ${JSON.stringify(error.value)}`);
  }
  console.log('');
});

console.log(`\n=== WARNING SUMMARY ===`);
const warnings = data.validationWarnings?.filter(e => e.severity === 'WARNING') || [];
console.log(`Total warnings: ${warnings.length}`);

// Group warnings by error code
const warningGroups = {};
warnings.forEach(w => {
  warningGroups[w.errorCode] = (warningGroups[w.errorCode] || 0) + 1;
});

console.log('\nWarnings by type:');
Object.entries(warningGroups).forEach(([code, count]) => {
  console.log(`  ${code}: ${count}`);
});
