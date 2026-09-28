import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import { getDb, audit } from './db.js';
import { decryptJson } from './crypto.js';
import { config } from './config.js';
import { getAdapter, withRetry } from '@untongue/provider-adapter';
import { AdapterError } from '@untongue/provider-adapter';

export type JobStatus =
  | 'queued' | 'provisioning' | 'running' | 'paused'
  | 'quota-exhausted' | 'failed' | 'pushed' | 'destroyed';

export interface CreateJobInput {
  userId: string;
  repoUrl: string;
  task: string;
  providerId: string;
  paidConsent?: boolean;
  allowSharedBranch?: boolean;
  sharedBranch?: string;
  machine?: string;
}

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 32) || 'task';
}

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' });
}

function log(jobId: string, line: string) {
  getDb().prepare('INSERT INTO job_logs (job_id, ts, line) VALUES (?, ?, ?)').run(jobId, new Date().toISOString(), line.slice(0, 4000));
}

function setStatus(jobId: string, status: JobStatus, error?: string) {
  getDb()
    .prepare('UPDATE jobs SET status = ?, error = ?, updated_at = ? WHERE id = ?')
    .run(status, error ?? null, new Date().toISOString(), jobId);
  log(jobId, `status -> ${status}${error ? `: ${error}` : ''}`);
}

/**
 * Concurrency rule (enforced by orchestrator, never by prompting the agent):
 * - Every job gets a uniquely named branch + isolated worktree/checkout.
 * - Two jobs on the same repo NEVER share a working directory.
 * - Override requires explicit allowSharedBranch + sharedBranch; audit-logged with conflict warning.
 */
export function createJob(input: CreateJobInput): { id: string; branch: string; workdir: string } {
  const db = getDb();
  const adapter = getAdapter(input.providerId);

  // Paid gate: never silently use paid resources.
  if (adapter.isPaid && !input.paidConsent) {
    throw new Error('Paid provider requires explicit paidConsent=true. Enable paid runtimes in the UI first.');
  }
  if (input.providerId === 'gcp-future') {
    throw new AdapterError('NOT_IMPLEMENTED', 'GCP adapter is not implemented in MVP.');
  }

  const id = `j_${Date.now().toString(36)}_${randomBytes(3).toString('hex')}`;
  const repoId = `r_${Buffer.from(input.repoUrl).toString('base64url').slice(0, 16)}`;
  mkdirSync(config.workRoot, { recursive: true });

  let branch: string;
  let workdir: string;

  if (input.allowSharedBranch) {
    if (!input.sharedBranch) throw new Error('allowSharedBranch requires sharedBranch name.');
    branch = input.sharedBranch;
    workdir = resolve(join(config.workRoot, input.userId, repoId, id));
    audit(input.userId, 'override-shared-branch', `job ${id} sharing branch ${branch}. WARNING: concurrent edits may conflict.`);
    log(id, `WARNING: shared-branch override on ${branch}. Conflicts possible; results pushed as-is for review.`);
  } else {
    branch = `agent/${id}-${slug(input.task)}-${randomBytes(2).toString('hex')}`;
    workdir = resolve(join(config.workRoot, input.userId, repoId, id));
  }

  if (existsSync(workdir)) throw new Error('workdir collision - refusing to share working directory (concurrency guard).');

  const repoRow = db.prepare('SELECT id FROM repos WHERE id = ?').get(repoId) as { id: string } | undefined;
  if (!repoRow) {
    db.prepare('INSERT INTO repos (id, user_id, url, created_at) VALUES (?, ?, ?, ?)').run(repoId, input.userId, input.repoUrl, new Date().toISOString());
  }

  const now = new Date().toISOString();
  try {
    db.prepare(
      'INSERT INTO jobs (id, user_id, repo_id, provider_id, branch, workdir, status, task, paid_consent, allow_shared, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    ).run(id, input.userId, repoId, input.providerId, branch, workdir, 'queued', input.task, input.paidConsent ? 1 : 0, input.allowSharedBranch ? 1 : 0, now, now);
  } catch (e) {
    throw new Error(`refusing duplicate workdir (concurrency guard): ${(e as Error).message}`);
  }
  log(id, `created branch=${branch} workdir=${workdir} provider=${input.providerId}`);
  return { id, branch, workdir };
}

/** Prepare isolated checkout: clone once per repo, then `git worktree add` per job. */
export function prepareWorktree(jobId: string): void {
  const db = getDb();
  const job = db.prepare('SELECT * FROM jobs WHERE id = ?').get(jobId) as Record<string, string | number>;
  const repo = db.prepare('SELECT * FROM repos WHERE id = ?').get(job['repo_id']) as { url: string };
  const userRoot = resolve(join(config.workRoot, String(job['user_id']), String(job['repo_id'])));
  const originDir = join(userRoot, '_origin');
  mkdirSync(userRoot, { recursive: true });

  setStatus(jobId, 'provisioning');
  if (!existsSync(originDir)) {
    log(jobId, `cloning ${repo.url} to origin cache`);
    execFileSync('git', ['clone', '--bare', repo.url, originDir], { encoding: 'utf8' });
  } else {
    try {
      git(originDir, 'fetch', 'origin', '+refs/heads/*:refs/heads/*');
    } catch (e) {
      log(jobId, `fetch warning: ${(e as Error).message}`);
    }
  }
  // Materialize a working clone if needed, then add isolated worktree.
  const seedDir = join(userRoot, '_seed');
  if (!existsSync(seedDir)) {
    execFileSync('git', ['clone', originDir, seedDir], { encoding: 'utf8' });
  }
  const workdir = String(job['workdir']);
  const branch = String(job['branch']);
  const allowShared = Number(job['allow_shared']) === 1;
  if (existsSync(workdir)) throw new Error('workdir already exists - refusing to reuse working directory.');
  try {
    if (allowShared) {
      execFileSync('git', ['-C', seedDir, 'fetch', originDir, '+refs/heads/*:refs/heads/*'], { encoding: 'utf8' });
      execFileSync('git', ['worktree', 'add', '--force', workdir, '-B', branch], { cwd: seedDir, encoding: 'utf8' });
    } else {
      const base = git(seedDir, 'rev-parse', 'HEAD').trim();
      execFileSync('git', ['worktree', 'add', workdir, '-b', branch, base], { cwd: seedDir, encoding: 'utf8' });
    }
  } catch (e) {
    // Fallback for file:// or shallow origins: plain clone + checkout -b (still isolated dir).
    mkdirSync(workdir, { recursive: true });
    execFileSync('git', ['clone', originDir, workdir], { encoding: 'utf8' });
    git(workdir, 'checkout', '-B', branch);
  }
  writeFileSync(join(workdir, '.untongue-task.md'), `# Task\n\n${String(job['task'])}\n\nBranch: ${branch}\nJob: ${jobId}\n`);
  log(jobId, `worktree ready at ${workdir} on ${branch}`);
}

/** Push results as separate branch for review. Repo is the durable source of truth. */
export function pushBranch(jobId: string): void {
  const db = getDb();
  const job = db.prepare('SELECT * FROM jobs WHERE id = ?').get(jobId) as Record<string, string>;
  const workdir = String(job['workdir']);
  try {
    git(workdir, 'add', '-A');
    try {
      git(workdir, 'commit', '-m', `agent: ${String(job['task']).slice(0, 120)} [${jobId}]`, '--allow-empty');
    } catch {
      // nothing to commit beyond task file is fine
    }
    git(workdir, 'push', '-u', 'origin', String(job['branch']));
    setStatus(jobId, 'pushed');
  } catch (e) {
    setStatus(jobId, 'failed', `push failed: ${(e as Error).message}`);
    throw e;
  }
}

/** Run one job end-to-end: worktree -> provision user-owned runtime -> opencode -> push. */
export async function runJob(jobId: string): Promise<void> {
  const db = getDb();
  const job = db.prepare('SELECT * FROM jobs WHERE id = ?').get(jobId) as Record<string, string | number> | undefined;
  if (!job || String(job['status']) !== 'queued') return;
  const adapter = getAdapter(String(job['provider_id']));

  try {
    prepareWorktree(jobId);

    // Load user credentials (decrypted in memory only, never logged).
    const rt = db.prepare('SELECT creds_enc FROM runtimes WHERE user_id = ? AND provider_id = ?').get(String(job['user_id']), String(job['provider_id'])) as { creds_enc: string } | undefined;
    const userRow = db.prepare('SELECT github_token_enc FROM users WHERE id = ?').get(String(job['user_id'])) as { github_token_enc: string } | undefined;
    const githubToken = userRow?.github_token_enc ? (decryptJson(userRow.github_token_enc)['GITHUB_TOKEN'] as string) : undefined;
    const creds: Record<string, string> = rt ? decryptJson(rt.creds_enc) : {};
    if (githubToken) creds['GITHUB_TOKEN'] = githubToken;

    const eligibility = await adapter.checkEligibility({ userCredentials: creds, githubToken });
    log(jobId, `eligibility: ${eligibility.eligible} - ${eligibility.reason}`);
    if (!eligibility.eligible) {
      setStatus(jobId, 'failed', eligibility.reason);
      return;
    }

    let handle;
    try {
      handle = await withRetry(() => adapter.provision({
        userId: String(job['user_id']),
        repoUrl: (db.prepare('SELECT url FROM repos WHERE id = ?').get(String(job['repo_id'])) as { url: string }).url,
        branch: String(job['branch']),
        userCredentials: creds,
        paidConsent: Number(job['paid_consent']) === 1,
      }), { attempts: 2, delayMs: 2000 });
    } catch (e) {
      if (e instanceof AdapterError && e.code === 'QUOTA_EXHAUSTED') {
        // Stop safely: keep worktree + branch, offer another provider. Never evade quotas.
        setStatus(jobId, 'quota-exhausted', `${e.message} Try another eligible provider (your branch ${String(job['branch'])} is preserved).`);
        return;
      }
      throw e;
    }
    db.prepare('UPDATE jobs SET runtime_id = ? WHERE id = ?').run(handle.runtimeId, jobId);

    // Start OpenCode against the isolated worktree (local MVP; remote exec on user VM/Codespace next).
    setStatus(jobId, 'running');
    const { startOpencode } = await import('./opencode.js');
    const session = await startOpencode({ workdir: String(job['workdir']), port: 4100 + (Math.abs(hash(jobId)) % 1000) });
    log(jobId, `opencode available at ${session.apiUrl} for job ${jobId} (drive via web UI; laptop may stay off once runtime is remote)`);
    // MVP worker stops here after health-check + task file; agent prompting happens via web UI.
    await session.stop();
    pushBranch(jobId);
  } catch (e) {
    setStatus(jobId, 'failed', (e as Error).message.slice(0, 500));
  }
}

function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return h;
}

export function getJob(userId: string, jobId: string) {
  const db = getDb();
  const job = db.prepare('SELECT * FROM jobs WHERE id = ?').get(jobId) as Record<string, unknown> | undefined;
  if (!job) return null;
  if (job['user_id'] !== userId) return 'forbidden' as const; // per-user isolation
  return job;
}
