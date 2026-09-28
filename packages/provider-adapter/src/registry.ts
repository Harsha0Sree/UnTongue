import type { ProviderAdapter } from './types.js';
import { OracleByomAdapter } from './oracle.js';
import { CodespacesAdapter } from './codespaces.js';
import { GcpFutureAdapter } from './gcp.js';
import { OraclePaidAdapter } from './paid.js';

export const adapters: Record<string, ProviderAdapter> = {
  'oracle-byom': new OracleByomAdapter(),
  'codespaces': new CodespacesAdapter(),
  'oracle-paid': new OraclePaidAdapter(),
  'gcp-future': new GcpFutureAdapter(),
};

export function getAdapter(id: string): ProviderAdapter {
  const a = adapters[id];
  if (!a) throw new Error(`unknown provider: ${id}`);
  return a;
}

export function capabilityMatrix() {
  return Object.values(adapters).map((a) => ({
    id: a.id,
    kind: a.kind,
    ownership: a.ownership,
    isPaid: a.isPaid,
    planName: a.info.planName,
    summary: a.info.summary,
    details: a.info.details,
    docsUrl: a.info.docsUrl,
    lastCheckedAt: a.info.lastCheckedAt,
  }));
}
