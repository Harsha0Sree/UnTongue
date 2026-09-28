import type { Eligibility, ProviderAdapter, ProvisionRequest, QuotaSnapshot, RuntimeHandle } from './types.js';
import { AdapterError } from './types.js';

/** GCP e2-micro free-tier slot. Eligibility shape only - provision is honestly not implemented. */
export class GcpFutureAdapter implements ProviderAdapter {
  id = 'gcp-future';
  kind = 'vm' as const;
  ownership = 'user-owned' as const;
  isPaid = false;
  info = {
    planName: 'GCP e2-micro free tier (planned)',
    summary: 'Planned next adapter: 1 e2-micro (0.25-2 vCPU, 1GB) + 30GB disk + 1GB egress free per month in select regions.',
    details: ['Adapter interface reserved. Provision is NOT implemented in MVP - tracked, not faked.'],
    docsUrl: 'https://cloud.google.com/free/docs/free-cloud-features',
    lastCheckedAt: '2026-09-28',
  };

  async checkEligibility(): Promise<Eligibility> {
    return { eligible: false, reason: 'GCP adapter is planned but not implemented in MVP. Use Oracle BYOM or Codespaces.', limits: this.info };
  }

  async getQuotas(): Promise<QuotaSnapshot> {
    return { providerId: this.id, remaining: null, exhausted: false, checkedAt: new Date().toISOString(), source: 'not-implemented' };
  }

  async provision(_req: ProvisionRequest): Promise<RuntimeHandle> {
    throw new AdapterError('NOT_IMPLEMENTED', 'GCP adapter is not implemented in MVP. This is an honest stub - no fake success.');
  }

  async destroy(): Promise<void> {
    return;
  }
}
