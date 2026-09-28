import type { ProvisionRequest, RuntimeHandle } from './types.js';
import { AdapterError } from './types.js';
import { OracleByomAdapter } from './oracle.js';

/** Paid opt-in: same user-owned tenancy, but allows paid shapes beyond Always Free. Never used without explicit consent. */
export class OraclePaidAdapter extends OracleByomAdapter {
  override id = 'oracle-paid';
  override isPaid = true;
  override info = {
    planName: 'Oracle paid shapes (user-owned billing, opt-in only)',
    summary: 'Paid OCI shapes in YOUR tenancy. Billed to you. Requires explicit paid consent per job.',
    details: [
      'Uses your tenancy + your billing. App never enables this without paidConsent=true.',
      'Example: VM.Standard.E4.Flex or A1 beyond Always Free limits.',
      'Free-first UI hides this unless you enable "Show paid runtimes".',
    ],
    docsUrl: 'https://www.oracle.com/cloud/pricing/',
    lastCheckedAt: '2026-09-28',
  };

  override async provision(req: ProvisionRequest): Promise<RuntimeHandle> {
    if (!req.paidConsent) {
      throw new AdapterError('AUTH_FAILED', 'Paid runtime requires explicit paidConsent=true. Enable paid runtimes in the UI first.');
    }
    return super.provision(req);
  }
}
