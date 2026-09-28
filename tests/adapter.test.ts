import { describe, it, expect } from 'vitest';
import { getAdapter } from '../packages/provider-adapter/src/registry.js';
import { AdapterError } from '../packages/provider-adapter/src/types.js';
import { withRetry } from '../packages/provider-adapter/src/effect-helpers.js';

describe('provider adapters: honest contracts', () => {
  it('all adapters expose user-owned + docs + last-checked', async () => {
    for (const id of ['oracle-byom', 'codespaces', 'oracle-paid', 'gcp-future']) {
      const a = getAdapter(id);
      expect(a.ownership).toBe('user-owned');
      expect(a.info.docsUrl.startsWith('https://')).toBe(true);
      expect(a.info.lastCheckedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      const q = await a.getQuotas({});
      expect(q.providerId).toBe(id);
    }
  });

  it('quota-exhausted is terminal (no retry evasion)', async () => {
    let calls = 0;
    await expect(
      withRetry(async () => {
        calls++;
        throw new AdapterError('QUOTA_EXHAUSTED', 'out of capacity');
      }, { attempts: 3 }),
    ).rejects.toThrow(/out of capacity/);
    expect(calls).toBe(1);
  });

  it('missing creds -> not eligible with reason (never fake eligible)', async () => {
    const oracle = getAdapter('oracle-byom');
    const e = await oracle.checkEligibility({ userCredentials: {} });
    expect(e.eligible).toBe(false);
    expect(e.reason).toMatch(/not connected|missing/i);
    const cs = getAdapter('codespaces');
    const e2 = await cs.checkEligibility({ userCredentials: {} });
    expect(e2.eligible).toBe(false);
  });

  it('paid requires explicit consent', async () => {
    const paid = getAdapter('oracle-paid');
    expect(paid.isPaid).toBe(true);
    await expect(paid.provision({ userId: 'u', repoUrl: 'https://github.com/a/b', branch: 'x', userCredentials: {} })).rejects.toThrow(/paidConsent/);
  });
});
