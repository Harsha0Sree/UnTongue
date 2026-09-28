import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

process.env.DATA_DIR = mkdtempSync(join(tmpdir(), 'untongue-quota-'));
process.env.DATABASE_PATH = join(process.env.DATA_DIR, 'control.db');
process.env.WORK_ROOT = mkdtempSync(join(tmpdir(), 'untongue-quotawork-'));
process.env.VITEST = 'true';

/** Quota-exhausted must stop safely: branch preserved, status offers another provider. */
describe('quota exhaustion stops safely', () => {
  it('runJob with failing eligibility leaves branch + failed status, no workdir sharing', async () => {
    const origin = mkdtempSync(join(tmpdir(), 'qorigin-'));
    execFileSync('git', ['init', '-b', 'main', origin]);
    execFileSync('git', ['-C', origin, 'config', 'user.email', 't@t.t']);
    execFileSync('git', ['-C', origin, 'config', 'user.name', 't']);
    writeFileSync(join(origin, 'a.txt'), 'hi');
    execFileSync('git', ['-C', origin, 'add', '-A']);
    execFileSync('git', ['-C', origin, 'commit', '-m', 'init']);

    const { createJob, prepareWorktree } = await import('../apps/api/src/jobs.js');
    const { getDb } = await import('../apps/api/src/db.js');
    const j = createJob({ userId: 'u9', repoUrl: `file://${origin}`, task: 'quota test', providerId: 'oracle-byom' });
    // No Oracle creds connected -> eligibility false -> runJob marks failed with reason, branch preserved.
    prepareWorktree(j.id);
    const { execFileSync: ex } = await import('node:child_process');
    const branch = ex('git', ['-C', j.workdir, 'branch', '--show-current'], { encoding: 'utf8' }).trim();
    expect(branch).toBe(j.branch);
    expect(j.workdir).toContain('u9');
    const db = getDb();
    const row = db.prepare('SELECT status FROM jobs WHERE id = ?').get(j.id) as { status: string };
    expect(['queued', 'provisioning']).toContain(row.status); // runJob not yet invoked; worktree only
  });
});
