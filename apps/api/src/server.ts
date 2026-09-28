import express from 'express';
import cookieParser from 'cookie-parser';
import { createHmac, randomBytes } from 'node:crypto';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import { config, requireEnvForProd } from './config.js';
import { getDb, audit } from './db.js';
import { encryptJson, decryptJson } from './crypto.js';
import { createJob, getJob, runJob } from './jobs.js';
import { capabilityMatrix, getAdapter } from '@untongue/provider-adapter';

const app = express();
app.use(express.json());
app.use(cookieParser(config.sessionSecret));

function sessionUser(req: express.Request): string | null {
  const signed = (req as unknown as { signedCookies: Record<string, string> }).signedCookies;
  return signed?.['uid'] ?? null;
}

function requireUser(req: express.Request, res: express.Response, next: express.NextFunction) {
  const uid = sessionUser(req);
  if (!uid) {
    res.status(401).json({ error: 'sign in with GitHub first' });
    return;
  }
  (req as unknown as { userId: string }).userId = uid;
  next();
}

// ---- Health ----
app.get('/api/health', (_req, res) => res.json({ ok: true, time: new Date().toISOString() }));

// ---- GitHub OAuth (sign-in only; NOT Actions OIDC) ----
app.get('/api/auth/github', (req, res) => {
  const state = randomBytes(16).toString('hex');
  res.cookie('oauth_state', state, { httpOnly: true, signed: true });
  const params = new URLSearchParams({
    client_id: config.github.clientId,
    redirect_uri: config.github.callbackUrl,
    scope: 'repo codespace read:user',
    state,
  });
  res.redirect(`https://github.com/login/oauth/authorize?${params}`);
});

app.get('/api/auth/github/callback', async (req, res) => {
  const { code, state } = req.query as Record<string, string>;
  const signed = (req as unknown as { signedCookies: Record<string, string> }).signedCookies;
  if (!code || state !== signed?.['oauth_state']) {
    res.status(400).send('OAuth state mismatch');
    return;
  }
  const tokenRes = await fetch('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_id: config.github.clientId, client_secret: config.github.clientSecret, code }),
  });
  const tokenJson = (await tokenRes.json()) as { access_token?: string; error?: string };
  if (!tokenJson.access_token) {
    res.status(401).send(`GitHub OAuth failed: ${tokenJson.error ?? 'no token'}`);
    return;
  }
  const meRes = await fetch('https://api.github.com/user', { headers: { Authorization: `Bearer ${tokenJson.access_token}`, Accept: 'application/vnd.github+json' } });
  const me = (await meRes.json()) as { id: number; login: string };
  const uid = `gh_${me.id}`;
  const db = getDb();
  const enc = encryptJson({ GITHUB_TOKEN: tokenJson.access_token });
  const existing = db.prepare('SELECT id FROM users WHERE id = ?').get(uid);
  if (existing) db.prepare('UPDATE users SET github_login = ?, github_token_enc = ? WHERE id = ?').run(me.login, enc, uid);
  else db.prepare('INSERT INTO users (id, github_login, github_token_enc, created_at) VALUES (?, ?, ?, ?)').run(uid, me.login, enc, new Date().toISOString());
  audit(uid, 'login', `github login ${me.login}`);
  res.cookie('uid', uid, { httpOnly: true, signed: true, sameSite: 'lax' });
  res.redirect('/');
});

app.post('/api/auth/logout', (req, res) => {
  res.clearCookie('uid');
  res.json({ ok: true });
});

// ---- Providers: free limits + eligibility + last-checked (free-first UI data) ----
app.get('/api/providers', async (req, res) => {
  const uid = sessionUser(req);
  const db = getDb();
  const matrix = capabilityMatrix();
  const out = await Promise.all(
    matrix.map(async (m) => {
      let eligibility = { eligible: false as boolean, reason: 'sign in to check your quota' };
      let quotas = null;
      if (uid) {
        try {
          const rt = db.prepare('SELECT creds_enc FROM runtimes WHERE user_id = ? AND provider_id = ?').get(uid, m.id) as { creds_enc: string } | undefined;
          const userRow = db.prepare('SELECT github_token_enc FROM users WHERE id = ?').get(uid) as { github_token_enc: string } | undefined;
          const creds = rt ? decryptJson(rt.creds_enc) : {};
          const ghToken = userRow?.github_token_enc ? (decryptJson(userRow.github_token_enc)['GITHUB_TOKEN'] as string) : undefined;
          const adapter = getAdapter(m.id);
          const e = await adapter.checkEligibility({ userCredentials: creds, githubToken: ghToken });
          eligibility = { eligible: e.eligible, reason: e.reason };
          quotas = await adapter.getQuotas(creds, ghToken).catch(() => null);
        } catch (e) {
          eligibility = { eligible: false, reason: (e as Error).message };
        }
      }
      return { ...m, eligibility, quotas };
    }),
  );
  res.json({ providers: out, freeFirst: true });
});

app.post('/api/providers/:id/reverify', requireUser, async (req, res) => {
  const userId = (req as unknown as { userId: string }).userId;
  const db = getDb();
  try {
    const adapter = getAdapter(req.params.id);
    const rt = db.prepare('SELECT creds_enc FROM runtimes WHERE user_id = ? AND provider_id = ?').get(userId, req.params.id) as { creds_enc: string } | undefined;
    const userRow = db.prepare('SELECT github_token_enc FROM users WHERE id = ?').get(userId) as { github_token_enc: string } | undefined;
    const creds = rt ? decryptJson(rt.creds_enc) : {};
    const ghToken = userRow?.github_token_enc ? (decryptJson(userRow.github_token_enc)['GITHUB_TOKEN'] as string) : undefined;
    const [e, q] = await Promise.all([adapter.checkEligibility({ userCredentials: creds, githubToken: ghToken }), adapter.getQuotas(creds, ghToken)]);
    audit(userId, 'reverify', `${req.params.id}: ${e.reason}`);
    res.json({ eligibility: e, quotas: q, docsUrl: adapter.info.docsUrl, lastCheckedAt: adapter.info.lastCheckedAt });
  } catch (e) {
    res.status(400).json({ error: (e as Error).message });
  }
});

// Connect user-owned runtime credentials (encrypted at rest, never returned).
app.post('/api/runtimes/connect', requireUser, (req, res) => {
  const userId = (req as unknown as { userId: string }).userId;
  const { providerId, credentials } = req.body as { providerId: string; credentials: Record<string, string> };
  if (!providerId || typeof credentials !== 'object') {
    res.status(400).json({ error: 'providerId + credentials required' });
    return;
  }
  try {
    getAdapter(providerId);
  } catch {
    res.status(400).json({ error: 'unknown provider' });
    return;
  }
  const db = getDb();
  db.prepare('INSERT INTO runtimes (user_id, provider_id, creds_enc, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(user_id, provider_id) DO UPDATE SET creds_enc = excluded.creds_enc, updated_at = excluded.updated_at')
    .run(userId, providerId, encryptJson(credentials), new Date().toISOString());
  audit(userId, 'runtime-connect', providerId);
  res.json({ ok: true, providerId, note: 'credentials encrypted at rest; only eligibility/quota derived values are ever shown' });
});

// ---- Jobs ----
app.post('/api/jobs', requireUser, async (req, res) => {
  const userId = (req as unknown as { userId: string }).userId;
  const { repoUrl, task, providerId, paidConsent, allowSharedBranch, sharedBranch, machine } = req.body as Record<string, unknown>;
  if (typeof repoUrl !== 'string' || typeof task !== 'string' || typeof providerId !== 'string') {
    res.status(400).json({ error: 'repoUrl, task, providerId required' });
    return;
  }
  if (!/^https:\/\/(github\.com|gitlab\.com)\//.test(repoUrl) && !repoUrl.startsWith('file://')) {
    res.status(400).json({ error: 'repoUrl must be https github/gitlab or file:// (SSRF guard)' });
    return;
  }
  try {
    const { id, branch, workdir } = createJob({
      userId, repoUrl, task, providerId,
      paidConsent: paidConsent === true,
      allowSharedBranch: allowSharedBranch === true,
      sharedBranch: typeof sharedBranch === 'string' ? sharedBranch : undefined,
      machine: typeof machine === 'string' ? machine : undefined,
    });
    audit(userId, 'job-create', `${id} ${providerId} ${branch}`);
    // Enqueue: worker polls `queued`; also kick inline for single-process dev so MVP works without worker.
    if (!process.env.WORKER_ONLY) void runJob(id);
    res.status(201).json({ id, branch, workdir, status: 'queued' });
  } catch (e) {
    res.status(400).json({ error: (e as Error).message });
  }
});

app.get('/api/jobs', requireUser, (req, res) => {
  const userId = (req as unknown as { userId: string }).userId;
  const rows = getDb().prepare('SELECT id, repo_id, provider_id, branch, status, task, runtime_id, error, created_at, updated_at FROM jobs WHERE user_id = ? ORDER BY created_at DESC LIMIT 50').all(userId);
  res.json({ jobs: rows });
});

app.get('/api/jobs/:id', requireUser, (req, res) => {
  const userId = (req as unknown as { userId: string }).userId;
  const job = getJob(userId, req.params.id);
  if (!job) {
    res.status(404).json({ error: 'not found' });
    return;
  }
  if (job === 'forbidden') {
    res.status(403).json({ error: 'forbidden: per-user isolation' });
    return;
  }
  const logs = getDb().prepare('SELECT ts, line FROM job_logs WHERE job_id = ? ORDER BY id ASC LIMIT 500').all(req.params.id);
  // Never expose workdir outside owner (path contains userId) - already gated by getJob.
  res.json({ job: { ...job }, logs });
});

app.get('/api/jobs/:id/diff', requireUser, async (req, res) => {
  const userId = (req as unknown as { userId: string }).userId;
  const job = getJob(userId, req.params.id);
  if (!job || job === 'forbidden') {
    res.status(job === 'forbidden' ? 403 : 404).json({ error: 'not found' });
    return;
  }
  const { execFileSync } = await import('node:child_process');
  try {
    const diff = execFileSync('git', ['diff', 'HEAD~1..HEAD', '--stat', '--patch'], { cwd: (job as Record<string, string>)['workdir'] as string, encoding: 'utf8', timeout: 10000 });
    res.json({ diff });
  } catch (e) {
    res.json({ diff: '', note: `diff unavailable: ${(e as Error).message}` });
  }
});

app.post('/api/jobs/:id/push', requireUser, async (req, res) => {
  const userId = (req as unknown as { userId: string }).userId;
  const job = getJob(userId, req.params.id);
  if (!job || job === 'forbidden') {
    res.status(job === 'forbidden' ? 403 : 404).json({ error: 'not found' });
    return;
  }
  try {
    const { pushBranch } = await import('./jobs.js');
    pushBranch(req.params.id);
    audit(userId, 'job-push', req.params.id);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
});

// ---- Serve web UI ----
const here = dirname(fileURLToPath(import.meta.url));
const webDir = join(here, '..', '..', '..', 'web');
if (existsSync(join(webDir, 'index.html'))) {
  app.use(express.static(webDir));
}

const missing = requireEnvForProd();
if (missing.length > 0) console.warn(`[warn] production env missing: ${missing.join(', ')}`);

const port = config.port;
if (process.env.VITEST !== 'true') {
  app.listen(port, () => console.log(`UnTongue api on :${port} (data: ${config.dbPath})`));
}

export default app;
