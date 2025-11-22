const fetch = require('node-fetch');

async function testAPI() {
  try {
    const response = await fetch('http://localhost:3000/api/goal-transactions?limit=3');
    const json = await response.json();

    console.log('Total count:', json.count);
    console.log('\nSample transactions:\n');

    json.data?.forEach((t, i) => {
      console.log(`${i + 1}. ${t.goalTransactionCode}`);
      console.log(`   Date: ${t.transactionDate.split('T')[0]}, Client: ${t.clientName}`);
      console.log(`   Amount: UGX ${t.totalAmount.toLocaleString()}, Fund TXs: ${t.fundTransactionCount}`);
      console.log(`   Types: ${t.transactionTypes}, Deposits: ${t.depositCount}, Withdrawals: ${t.withdrawalCount}`);
      console.log(`   XUMMF: ${t.XUMMF}, XUBF: ${t.XUBF}, XUDEF: ${t.XUDEF}, XUREF: ${t.XUREF}\n`);
    });
  } catch (error) {
    console.error('Error:', error.message);
  }
}

testAPI();
