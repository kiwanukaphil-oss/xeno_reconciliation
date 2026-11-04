// Drives a series of fund transaction uploads (PLAN below; written for the 2026 catch-up) in upload-date order. For each file: upload, wait,
// approve new entities (user gave blanket approval on 2026-11-03), wait for COMPLETED, log one summary line.
// Stops on a failed batch or an unusual new-entity profile so the user can review.
// Usage: node scripts/run-ultima-fund-uploads.js [batchIdAlreadyWaiting]
const fs = require('fs');
const path = require('path');
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const API = 'http://localhost:3000/api/fund-upload';
const DIR = 'Client data/2026/Fund Transactions/prepared';
const PLAN = [
  ['Ultima Fund Transactions Data Export -2026-11-02 19_00_49.xlsx', '2026-01a Ultima uploads 01-01 to 01-13.xlsx'],
  ['Ultima Fund Transactions Data Export -2026-11-02 19_00_49 (1).xlsx', '2026-01b Ultima uploads 01-19 to 01-30.xlsx'],
  ['Ultima Fund Transactions Data Export -2026-11-02 19_31_50.xlsx', '2026-02a Ultima uploads 02-01 to 02-13.xlsx'],
  ['Ultima Fund Transactions Data 2026-02-14 to 2026-03-01.xlsx', '2026-02b Ultima uploads 02-14 to 03-01.xlsx'],
  ['Ultima Fund Transactions Data Export -2026-11-02 19_31_50 (1).xlsx', '2026-03a Ultima uploads 03-02 to 03-13.xlsx'],
  ['Ultima Fund Transactions Data Export -2026-11-02 19_31_50 (2).xlsx', '2026-03b Ultima uploads 03-18 to 03-30.xlsx'],
  ['Ultima Fund Transactions Data Export -2026-11-02 19_31_50 (3).xlsx', '2026-04a Ultima uploads 04-01 to 04-14.xlsx'],
  ['Ultima Fund Transactions Data 2026-04-15 to 2026-05-03.xlsx', '2026-04b Ultima uploads 04-15 to 05-03.xlsx'],
  ['Ultima Fund Transactions Data Export -2026-11-02 19_31_50 (4).xlsx', '2026-05a Ultima uploads 05-04 to 05-15.xlsx'],
  ['Ultima Fund Transactions Data Export -2026-11-02 19_31_50 (5).xlsx', '2026-05b Ultima uploads 05-19 to 05-31.xlsx'],
  ['Ultima Fund Transactions Data Export -2026-11-02 19_31_50 (6).xlsx', '2026-06a Ultima uploads 06-01 to 06-15.xlsx'],
  ['Ultima Fund Transactions Data 2026-06-16 to 2026-06-30.xlsx', '2026-06b Ultima uploads 06-16 to 06-30.xlsx'],
  ['Ultima Fund Transactions Data 2026-07-01 to 2026-07-15.xlsx', '2026-07a Ultima uploads 07-01 to 07-15.xlsx'],
  ['Ultima Fund Transactions Data 2026-07-16 to 2026-07-31.xlsx', '2026-07b Ultima uploads 07-16 to 07-31.xlsx'],
  ['Ultima Fund Transactions Data 2026-08-01 to 2026-08-15.xlsx', '2026-08a Ultima uploads 08-01 to 08-15.xlsx'],
  ['Ultima Fund Transactions Data 2026-08-16 to 2026-08-31.xlsx', '2026-08b Ultima uploads 08-16 to 08-31.xlsx'],
  ['Ultima Fund Transactions Data 2026-09-01 to 2026-09-15.xlsx', '2026-09a Ultima uploads 09-01 to 09-15.xlsx'],
  ['Ultima Fund Transactions Data 2026-09-16 to 2026-09-30.xlsx', '2026-09b Ultima uploads 09-16 to 09-30.xlsx'],
  ['Ultima Fund Transactions Data 2026-10-01 to 2026-10-15.xlsx', '2026-10a Ultima uploads 10-01 to 10-15.xlsx'],
  ['Ultima Fund Transactions Data 2026-10-16 to 2026-10-31.xlsx', '2026-10b Ultima uploads 10-16 to 10-31.xlsx'],
];
// "Unusual" thresholds: well above the Dec and Jan batches (Jan: 1,386 clients, 54 renames)
const MAX_NEW_CLIENTS = 4000;
const MAX_RENAMES = 200;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (msg) => console.log(`${new Date().toISOString().slice(11, 19)} ${msg}`);

/** Poll batch status until it reaches one of the wanted states (or a terminal failure). */
async function waitForBatchState(batchId, wanted) {
  for (;;) {
    try {
      const s = await (await fetch(`${API}/batches/${batchId}/status`)).json();
      if (wanted.includes(s.processingStatus) || ['FAILED', 'CANCELLED'].includes(s.processingStatus)) return s;
    } catch { /* API briefly busy; keep polling */ }
    await sleep(10000);
  }
}

/** Count new-entity indicators used to decide whether a batch is out of pattern. */
async function summariseNewEntities(batchId) {
  const b = await prisma.uploadBatch.findUnique({ where: { id: batchId }, select: { newEntitiesReport: true } });
  const ne = b.newEntitiesReport || { clients: [], accounts: [], goals: [] };
  const renames = ne.clients.filter((c) => !ne.accounts.some((a) => a.clientName === c.clientName)).length;
  return { clients: ne.clients.length, accounts: ne.accounts.length, goals: ne.goals.length, renames };
}

/** Run one batch from upload (or from an already-waiting batch) to COMPLETED; returns false to stop the run. */
async function runOneBatch(file, batchName, existingBatchId) {
  let batchId = existingBatchId;
  if (!batchId) {
    const form = new FormData();
    form.append('file', new Blob([fs.readFileSync(path.join(DIR, file))]), batchName);
    const res = await (await fetch(`${API}/upload`, { method: 'POST', body: form })).json();
    if (!res.batchId) { log(`UPLOAD FAILED ${batchName}: ${JSON.stringify(res)}`); return false; }
    batchId = res.batchId;
  }
  let s = await waitForBatchState(batchId, ['WAITING_FOR_APPROVAL', 'COMPLETED']);
  if (s.processingStatus === 'FAILED' || s.failedRecords > 0) { log(`STOP ${batchName} ${s.batchNumber}: ${s.processingStatus}, failed rows ${s.failedRecords}`); return false; }
  let ents = { clients: 0, accounts: 0, goals: 0, renames: 0 };
  if (s.processingStatus === 'WAITING_FOR_APPROVAL') {
    ents = await summariseNewEntities(batchId);
    if (ents.clients > MAX_NEW_CLIENTS || ents.renames > MAX_RENAMES) { log(`STOP ${batchName} ${s.batchNumber}: unusual new entities ${JSON.stringify(ents)} (left waiting)`); return false; }
    await fetch(`${API}/batches/${batchId}/approve-entities`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ approvalStatus: 'approved' }) });
    s = await waitForBatchState(batchId, ['COMPLETED']);
  }
  const saved = await prisma.fundTransaction.count({ where: { uploadBatchId: batchId } });
  log(`DONE ${batchName} ${s.batchNumber} ${s.processingStatus} rows ${s.totalRecords} saved ${saved} | new clients ${ents.clients} accounts ${ents.accounts} goals ${ents.goals} renames ${ents.renames}`);
  return s.processingStatus === 'COMPLETED' && saved === s.totalRecords;
}

(async () => {
  // Args: [batchIdAlreadyWaiting|-] [startIndex]
  const waitingBatchId = process.argv[2] && process.argv[2] !== '-' ? process.argv[2] : undefined;
  const startIndex = Number(process.argv[3] || 0);
  for (let i = startIndex; i < PLAN.length; i++) {
    const ok = await runOneBatch(PLAN[i][0], PLAN[i][1], i === startIndex ? waitingBatchId : undefined);
    if (!ok) { log('Run stopped.'); break; }
  }
  log('Run finished.');
  await prisma.$disconnect();
})();
