import { describe, it, expect, beforeEach } from 'vitest';
import { execFileSync, execSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.DATA_DIR = mkdtempSync(join(tmpdir(), 'untongue-data-'));
process.env.DATABASE_PATH = join(process.env.DATA_DIR, 'control.db');
process.env.WORK_ROOT = mkdtempSync(join(tmpdir(), 'untongue-work-'));
process.env.VITEST = 'true';

const { createJob, prepareWorktree } = await import('../apps/api/src/jobs.js');

function makeOrigin(): string {
  const dir = mkdtempSync(join(tmpdir(), 'origin-'));
  execFileSync('git', ['init', '-b', 'main', dir]);
  execFileSync('git', ['-C', dir, 'config', 'user.email', 't@t.t']);
  execFileSync('git', ['-C', dir, 'config', 'user.name', 't']);
  writeFileSync(join(dir, 'README.md'), '# test\n');
  execFileSync('git', ['-C', dir, 'add', '-A']);
  execFileSync('git', ['-C', dir, 'commit', '-m', 'init']);
  return dir;
}

describe('concurrency: isolated branches + worktrees', () => {
  it('two jobs on same repo get unique branches and dirs', () => {
    const origin = makeOrigin();
    const repoUrl = `file://${origin}`;
    const a = createJob({ userId: 'u1', repoUrl, task: 'fix login', providerId: 'oracle-byom' });
    const b = createJob({ userId: 'u1', repoUrl, task: 'fix login', providerId: 'oracle-byom' });
    expect(a.branch).not.toBe(b.branch);
    expect(a.workdir).not.toBe(b.workdir);
    expect(a.branch.startsWith('agent/')).toBe(true);
    prepareWorktree(a.id);
    prepareWorktree(b.id);
    // both worktrees exist and are distinct git checkouts
    const ba = execFileSync('git', ['-C', a.workdir, 'branch', '--show-current'], { encoding: 'utf8' }).trim();
    const bb = execFileSync('git', ['-C', b.workdir, 'branch', '--show-current'], { encoding: 'utf8' }).trim();
    expect(ba).toBe(a.branch);
    expect(bb).toBe(b.branch);
  });

  it('shared-branch override requires explicit flag and warns', () => {
    const origin = makeOrigin();
    const repoUrl = `file://${origin}`;
    expect(() => createJob({ userId: 'u1', repoUrl, task: 'x', providerId: 'oracle-byom', allowSharedBranch: true })).toThrow(/sharedBranch/);
    const j = createJob({ userId: 'u1', repoUrl, task: 'x', providerId: 'oracle-byom', allowSharedBranch: true, sharedBranch: 'main' });
    expect(j.branch).toBe('main');
  });
});
