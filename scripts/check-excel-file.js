const XLSX = require('xlsx');
const path = require('path');

async function checkExcelFile() {
  try {
    const filePath = process.argv[2];

    if (!filePath) {
      console.error('Usage: node check-excel-file.js <path-to-excel-file>');
      process.exit(1);
    }

    console.log(`\nAnalyzing Excel file: ${filePath}\n`);

    // Read the Excel file
    const workbook = XLSX.readFile(filePath);

    // List all sheets
    console.log('=== SHEETS ===');
    console.log(`Total sheets: ${workbook.SheetNames.length}`);
    workbook.SheetNames.forEach((name, index) => {
      console.log(`  ${index + 1}. ${name}`);
    });

    // Get the first sheet
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];

    console.log(`\n=== ANALYZING FIRST SHEET: "${sheetName}" ===\n`);

    // Get range
    const range = XLSX.utils.decode_range(worksheet['!ref'] || 'A1');
    console.log(`Total rows: ${range.e.r + 1} (including header)`);
    console.log(`Total columns: ${range.e.c + 1}\n`);

    // Get headers
    console.log('=== HEADERS ===');
    const headers = [];
    for (let col = range.s.c; col <= range.e.c; col++) {
      const cellAddress = XLSX.utils.encode_cell({ r: range.s.r, c: col });
      const cell = worksheet[cellAddress];
      if (cell && cell.v) {
        const header = String(cell.v).trim();
        headers.push(header);
        console.log(`  Column ${col + 1}: "${header}"`);
      }
    }

    // Check required headers
    const requiredHeaders = [
      'fundTransactionId',
      'transactionDate',
      'clientName',
      'fundCode',
      'amount',
      'units',
      'transactionType',
      'bidPrice',
      'offerPrice',
      'midPrice',
      'dateCreated',
      'goalTitle',
      'goalNumber',
      'accountNumber',
      'accountType',
      'accountCategory',
    ];

    console.log('\n=== HEADER VALIDATION ===');
    const missingHeaders = requiredHeaders.filter(h => !headers.includes(h));
    const extraHeaders = headers.filter(h => !requiredHeaders.includes(h) && h !== 'sponsorCode');

    if (missingHeaders.length > 0) {
      console.log('❌ Missing required headers:');
      missingHeaders.forEach(h => console.log(`   - ${h}`));
    } else {
      console.log('✅ All required headers present');
    }

    if (extraHeaders.length > 0) {
      console.log('\nExtra headers (not required):');
      extraHeaders.forEach(h => console.log(`   - ${h}`));
    }

    // Convert to JSON to see sample data
    const rawData = XLSX.utils.sheet_to_json(worksheet, {
      raw: false,
      defval: '',
    });

    console.log(`\n=== DATA ROWS ===`);
    console.log(`Total data rows: ${rawData.length}\n`);

    // Show first 3 rows
    if (rawData.length > 0) {
      console.log('First row sample:');
      const firstRow = rawData[0];
      Object.keys(firstRow).forEach(key => {
        const value = firstRow[key];
        const displayValue = String(value).length > 50
          ? String(value).substring(0, 50) + '...'
          : value;
        console.log(`  ${key}: "${displayValue}"`);
      });

      // Check for empty rows
      let emptyRows = 0;
      rawData.forEach((row, index) => {
        const values = Object.values(row);
        const isEmpty = values.every(val => !val || String(val).trim() === '');
        if (isEmpty) {
          emptyRows++;
        }
      });

      if (emptyRows > 0) {
        console.log(`\n⚠️  Found ${emptyRows} empty rows`);
      }

      // Check for rows with missing fundTransactionId
      let missingId = 0;
      rawData.forEach((row) => {
        if (!row.fundTransactionId || String(row.fundTransactionId).trim() === '') {
          missingId++;
        }
      });

      if (missingId > 0) {
        console.log(`❌ Found ${missingId} rows with missing fundTransactionId`);
      }

      // Check for rows with missing transactionDate
      let missingDate = 0;
      rawData.forEach((row) => {
        if (!row.transactionDate || String(row.transactionDate).trim() === '') {
          missingDate++;
        }
      });

      if (missingDate > 0) {
        console.log(`❌ Found ${missingDate} rows with missing transactionDate`);
      }
    }

  } catch (error) {
    console.error('\n❌ Error analyzing file:', error.message);
    console.error(error.stack);
  }
}

checkExcelFile();
