const XLSX = require('xlsx');
const path = require('path');

// Create a new workbook
const workbook = XLSX.utils.book_new();

// Sample data for bid prices
const bidData = [
  { Date: '2024-01-15', XUMMF: 1250.50, XUBF: 1180.25, XUDEF: 1095.80, XUREF: 1320.40 },
  { Date: '2024-01-16', XUMMF: 1251.20, XUBF: 1181.10, XUDEF: 1096.50, XUREF: 1321.25 },
  { Date: '2024-01-17', XUMMF: 1252.00, XUBF: 1182.00, XUDEF: 1097.30, XUREF: 1322.15 },
];

// Sample data for mid prices
const midData = [
  { Date: '2024-01-15', XUMMF: 1251.00, XUBF: 1181.00, XUDEF: 1096.50, XUREF: 1321.25 },
  { Date: '2024-01-16', XUMMF: 1251.70, XUBF: 1181.85, XUDEF: 1097.20, XUREF: 1322.10 },
  { Date: '2024-01-17', XUMMF: 1252.50, XUBF: 1182.75, XUDEF: 1098.00, XUREF: 1323.00 },
];

// Sample data for offer prices
const offerData = [
  { Date: '2024-01-15', XUMMF: 1251.50, XUBF: 1181.75, XUDEF: 1097.20, XUREF: 1322.10 },
  { Date: '2024-01-16', XUMMF: 1252.20, XUBF: 1182.60, XUDEF: 1097.90, XUREF: 1322.95 },
  { Date: '2024-01-17', XUMMF: 1253.00, XUBF: 1183.50, XUDEF: 1098.70, XUREF: 1323.85 },
];

// Create worksheets from data
const bidSheet = XLSX.utils.json_to_sheet(bidData);
const midSheet = XLSX.utils.json_to_sheet(midData);
const offerSheet = XLSX.utils.json_to_sheet(offerData);

// Add worksheets to workbook
XLSX.utils.book_append_sheet(workbook, bidSheet, 'bid');
XLSX.utils.book_append_sheet(workbook, midSheet, 'mid');
XLSX.utils.book_append_sheet(workbook, offerSheet, 'offer');

// Write to file
const outputPath = path.join(__dirname, '..', 'Reference Docs', 'fund_prices_template.xlsx');
XLSX.writeFile(workbook, outputPath);

console.log('Fund prices template created:', outputPath);
