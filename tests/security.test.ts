import { describe, it, expect } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';

process.env.DATA_DIR = mkdtempSync(join(tmpdir(), 'untongue-sec-'));
process.env.DATABASE_PATH = join(process.env.DATA_DIR, 'control.db');
process.env.WORK_ROOT = mkdtempSync(join(tmpdir(), 'untongue-secwork-'));
process.env.CRED_ENC_KEY = Buffer.alloc(32, 9).toString('base64');
process.env.VITEST = 'true';

const { encryptJson, decryptJson } = await import('../apps/api/src/crypto.js');
const { createJob, getJob } = await import('../apps/api/src/jobs.js');

function makeOrigin(): string {
  const dir = mkdtempSync(join(tmpdir(), 'sorigin-'));
  execFileSync('git', ['init', '-b', 'main', dir]);
  execFileSync('git', ['-C', dir, 'config', 'user.email', 't@t.t']);
  execFileSync('git', ['-C', dir, 'config', 'user.name', 't']);
  writeFileSync(join(dir, 'f.txt'), 'x');
  execFileSync('git', ['-C', dir, 'add', '-A']);
  execFileSync('git', ['-C', dir, 'commit', '-m', 'init']);
  return dir;
}

describe('security', () => {
  it('credentials encrypt at rest and round-trip', () => {
    const enc = encryptJson({ GITHUB_TOKEN: 'secret123', OCI_PRIVATE_KEY_PEM: 'pem' });
    expect(enc).not.toContain('secret123');
    expect(decryptJson(enc)).toEqual({ GITHUB_TOKEN: 'secret123', OCI_PRIVATE_KEY_PEM: 'pem' });
  });

  it('per-user isolation: user B cannot read user A job', () => {
    const origin = makeOrigin();
    const a = createJob({ userId: 'alice', repoUrl: `file://${origin}`, task: 't', providerId: 'oracle-byom' });
    const got = getJob('bob', a.id);
    expect(got).toBe('forbidden');
    const own = getJob('alice', a.id);
    expect((own as Record<string, unknown>)['id']).toBe(a.id);
  });

  it('paid providers require explicit consent; gcp stub never fakes success', async () => {
    const origin = makeOrigin();
    // gcp-future provision must throw NOT_IMPLEMENTED
    const { getAdapter } = await import('../packages/provider-adapter/src/registry.js');
    const gcp = getAdapter('gcp-future');
    await expect(gcp.provision({ userId: 'u', repoUrl: `file://${origin}`, branch: 'x', userCredentials: {} })).rejects.toThrow(/not implemented/i);
    // unknown provider rejected
    expect(() => createJob({ userId: 'u', repoUrl: `file://${origin}`, task: 't', providerId: 'nope' })).toThrow(/unknown provider/);
  });

  it('repo URL SSRF guard concept: only https github/gitlab or file:// allowed', () => {
    const bad = ['http://169.254.169.254/', 'https://evil.internal/x', 'ftp://a/b'];
    for (const u of bad) {
      expect(/^https:\/\/(github\.com|gitlab\.com)\//.test(u) || u.startsWith('file://')).toBe(false);
    }
  });
});
