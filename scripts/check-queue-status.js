const { Queue } = require('bullmq');
const { connection } = require('../dist/config/queue');

async function checkQueueStatus() {
  const queue = new Queue('fund-processing', { connection });

  try {
    console.log('=== QUEUE STATUS ===\n');

    const waiting = await queue.getWaiting();
    const active = await queue.getActive();
    const completed = await queue.getCompleted();
    const failed = await queue.getFailed();
    const delayed = await queue.getDelayed();

    console.log(`Waiting jobs: ${waiting.length}`);
    console.log(`Active jobs: ${active.length}`);
    console.log(`Completed jobs: ${completed.length}`);
    console.log(`Failed jobs: ${failed.length}`);
    console.log(`Delayed jobs: ${delayed.length}`);

    if (waiting.length > 0) {
      console.log('\n=== WAITING JOBS ===');
      waiting.forEach(job => {
        console.log(`Job ID: ${job.id}`);
        console.log(`Job Name: ${job.name}`);
        console.log(`Batch ID: ${job.data.batchId}`);
        console.log(`File: ${job.data.filePath}`);
        console.log('---');
      });
    }

    if (active.length > 0) {
      console.log('\n=== ACTIVE JOBS ===');
      active.forEach(job => {
        console.log(`Job ID: ${job.id}`);
        console.log(`Job Name: ${job.name}`);
        console.log(`Batch ID: ${job.data.batchId}`);
        console.log(`Progress: ${job.progress}%`);
        console.log('---');
      });
    }

    if (failed.length > 0) {
      console.log('\n=== RECENT FAILED JOBS ===');
      failed.slice(0, 5).forEach(job => {
        console.log(`Job ID: ${job.id}`);
        console.log(`Job Name: ${job.name}`);
        console.log(`Batch ID: ${job.data.batchId}`);
        console.log(`Failed Reason: ${job.failedReason}`);
        console.log('---');
      });
    }

  } catch (error) {
    console.error('Error checking queue:', error.message);
  } finally {
    await queue.close();
    process.exit(0);
  }
}

checkQueueStatus();
