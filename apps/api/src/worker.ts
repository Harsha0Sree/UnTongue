import { getDb } from './db.js';
import { runJob } from './jobs.js';

/** DB-backed job queue: polls `queued` jobs. Swap for BullMQ/Redis by replacing claimNext(). */
function claimNext(): string | null {
  const db = getDb();
  const row = db.prepare("SELECT id FROM jobs WHERE status = 'queued' ORDER BY created_at ASC LIMIT 1").get() as { id: string } | undefined;
  return row?.id ?? null;
}

async function tick() {
  const id = claimNext();
  if (id) await runJob(id);
}

console.log('UnTongue worker polling queued jobs...');
setInterval(() => {
  tick().catch((e) => console.error('worker tick failed', e));
}, 2000);
void tick();
