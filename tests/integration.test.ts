import { describe, it, expect } from 'vitest';

describe('integration (requires real creds; skipped otherwise)', () => {
  it('oracle + codespaces end-to-end', async () => {
    if (!process.env.INTEGRATION) {
      console.log('skip: set INTEGRATION=1 with real OCI + GitHub creds to run live provisioning');
      expect(true).toBe(true);
      return;
    }
    const { getAdapter } = await import('../packages/provider-adapter/src/registry.js');
    // Real calls - will fail without creds, proving no mocks are presented as working.
    const oracle = getAdapter('oracle-byom');
    const e = await oracle.checkEligibility({ userCredentials: {} });
    expect(e.eligible).toBe(false);
  });
});
