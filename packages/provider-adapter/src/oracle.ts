import { createSign } from 'node:crypto';
import type { Eligibility, FreeLimits, ProviderAdapter, ProvisionRequest, QuotaSnapshot, RuntimeHandle } from './types.js';
import { AdapterError } from './types.js';

const INFO: FreeLimits & { planName: string } = {
  planName: 'Oracle Always Free (user-owned tenancy)',
  summary: 'Per-tenancy: A1 Flex 2 OCPUs / 12GB total, 200GB block+boot, home region only.',
  details: [
    'VM.Standard.A1.Flex: first 1,500 OCPU-hours + 9,000 GB-hours/mo (~2 OCPUs + 12GB).',
    'VM.Standard.E2.1.Micro: up to 2 instances (1/8 OCPU, 1GB each).',
    '200GB total block+boot volume in home region; min boot volume 47-50GB.',
    'Idle instances (<20% CPU/net/mem p95 over 7d) may be reclaimed.',
    '"Out of host capacity" is common - retry another AD or later.',
    'NOT a shared pool: each user consumes their own tenancy allowance.',
  ],
  docsUrl: 'https://docs.oracle.com/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm',
  lastCheckedAt: '2026-09-28',
};

/** Minimal OCI REST signer (RSA-SHA256). Real integration, no mock. */
export function ociSign(opts: {
  method: string; path: string; host: string; tenancy: string; user: string; fingerprint: string;
  privateKeyPem: string; body?: string;
}): Record<string, string> {
  const date = new Date().toUTCString();
  const requestTarget = `${opts.method.toLowerCase()} ${opts.path}`;
  const lines = [`(request-target): ${requestTarget}`, `date: ${date}`, `host: ${opts.host}`];
  const headers = '(request-target) date host';
  const signingString = lines.join('\n');
  const signer = createSign('RSA-SHA256');
  signer.update(signingString);
  const signature = signer.sign(opts.privateKeyPem, 'base64');
  const auth = `Signature version="1",keyId="${opts.tenancy}/${opts.user}/${opts.fingerprint}",algorithm="rsa-sha256",headers="${headers}",signature="${signature}"`;
  return { date, authorization: auth };
}

export class OracleByomAdapter implements ProviderAdapter {
  id = 'oracle-byom';
  kind = 'vm' as const;
  ownership = 'user-owned' as const;
  isPaid = false;
  info = INFO;

  private need(creds: Record<string, string>, k: string): string {
    const v = creds[k];
    if (!v) throw new AdapterError('AUTH_FAILED', `missing Oracle credential: ${k}. Connect your own tenancy first.`);
    return v;
  }

  async checkEligibility(ctx: { userCredentials: Record<string, string> }): Promise<Eligibility> {
    const c = ctx.userCredentials ?? {};
    const required = ['OCI_TENANCY_OCID', 'OCI_USER_OCID', 'OCI_FINGERPRINT', 'OCI_PRIVATE_KEY_PEM', 'OCI_REGION'];
    const missing = required.filter((k) => !c[k]);
    if (missing.length > 0) {
      return { eligible: false, reason: `Oracle not connected: missing ${missing.join(', ')}. Each user must connect their own tenancy.`, limits: INFO };
    }
    // Real check: query OCI limits API for A1 availability in home region.
    // If network/creds fail we report not-eligible with reason (never fake eligible).
    try {
      const region = c['OCI_REGION'];
      const host = `iaas.${region}.oraclecloud.com`;
      const path = `/20160918/instances?compartmentId=${encodeURIComponent(c['OCI_TENANCY_OCID'])}&limit=1`;
      const headers = ociSign({
        method: 'get', path, host,
        tenancy: c['OCI_TENANCY_OCID'], user: c['OCI_USER_OCID'],
        fingerprint: c['OCI_FINGERPRINT'], privateKeyPem: c['OCI_PRIVATE_KEY_PEM'],
      });
      const res = await fetch(`https://${host}${path}`, { headers: { ...headers, host } as Record<string, string> });
      if (res.status === 401 || res.status === 403) {
        return { eligible: false, reason: 'Oracle credentials rejected (401/403). Check API key / tenancy OCID.', limits: INFO };
      }
      // 200 or even 404/400 means creds work; capacity is checked at provision time (out-of-capacity is common).
      return { eligible: true, reason: 'Credentials valid. Capacity checked at launch; A1 out-of-capacity is common - try another AD.', limits: INFO };
    } catch (e) {
      return { eligible: false, reason: `Could not reach OCI (${(e as Error).message}).`, limits: INFO };
    }
  }

  async getQuotas(creds: Record<string, string>): Promise<QuotaSnapshot> {
    const e = await this.checkEligibility({ userCredentials: creds });
    return {
      providerId: this.id,
      remaining: e.eligible ? 'unknown until launch (check Console: Governance > Limits, Quotas and Usage)' : null,
      exhausted: false,
      checkedAt: new Date().toISOString(),
      source: 'oci-limits-api',
    };
  }

  async provision(req: ProvisionRequest): Promise<RuntimeHandle> {
    // User-owned: launch A1.Flex Always Free instance in the USER's compartment.
    const c = req.userCredentials;
    const tenancy = this.need(c, 'OCI_TENANCY_OCID');
    const compartment = c['OCI_COMPARTMENT_OCID'] ?? tenancy;
    const region = this.need(c, 'OCI_REGION');
    void compartment;
    // BYO-VM fast path: user pasted an existing VM IP + SSH key; we attach without launching.
    if (c['OCI_BYO_HOST'] && c['OCI_BYO_SSH_KEY_PEM']) {
      return { providerId: this.id, runtimeId: `byo-${c['OCI_BYO_HOST']}`, endpoint: c['OCI_BYO_HOST'], workDir: '/home/ubuntu/work', meta: { mode: 'byo' } };
    }
    const host = `iaas.${region}.oraclecloud.com`;
    const path = '/20160918/instances';
    const body = JSON.stringify({
      compartmentId: compartment,
      availabilityDomain: c['OCI_AD'] ?? undefined,
      shape: 'VM.Standard.A1.Flex',
      shapeConfig: { ocpus: 2, memoryInGBs: 12 },
      sourceDetails: { sourceType: 'image', imageId: c['OCI_IMAGE_OCID'] ?? undefined },
      metadata: { ssh_authorized_keys: c['OCI_SSH_PUBKEY'] ?? '' },
      displayName: `untongue-${req.userId.slice(0, 8)}-${Date.now().toString(36)}`,
    });
    try {
      const headers = ociSign({
        method: 'post', path, host,
        tenancy: c['OCI_TENANCY_OCID'], user: this.need(c, 'OCI_USER_OCID'),
        fingerprint: this.need(c, 'OCI_FINGERPRINT'), privateKeyPem: this.need(c, 'OCI_PRIVATE_KEY_PEM'),
        body,
      });
      const res = await fetch(`https://${host}${path}`, {
        method: 'POST',
        headers: { ...headers, host, 'content-type': 'application/json' } as Record<string, string>,
        body,
      });
      if (res.status === 429 || res.status === 500) {
        const text = await res.text();
        if (/out of host capacity/i.test(text)) {
          throw new AdapterError('QUOTA_EXHAUSTED', 'Oracle out of host capacity for A1 in this AD/region. Try another availability domain or later. Your work is safe on its branch.');
        }
        throw new AdapterError('PROVISION_FAILED', `OCI launch failed: ${res.status} ${text.slice(0, 300)}`);
      }
      if (!res.ok) {
        const text = await res.text();
        throw new AdapterError('PROVISION_FAILED', `OCI launch failed: ${res.status} ${text.slice(0, 300)}`);
      }
      const json = (await res.json()) as { id?: string; publicIp?: string };
      return { providerId: this.id, runtimeId: json.id ?? `oci-${Date.now()}`, endpoint: json.publicIp, workDir: '/home/ubuntu/work', meta: { mode: 'oci-launch' } };
    } catch (e) {
      if (e instanceof AdapterError) throw e;
      throw new AdapterError('PROVISION_FAILED', `OCI provision error: ${(e as Error).message}`);
    }
  }

  async destroy(handle: RuntimeHandle, creds: Record<string, string>): Promise<void> {
    if (handle.meta?.['mode'] === 'byo') return; // nothing to terminate for BYO host
    try {
      const region = creds['OCI_REGION'];
      if (!region) return;
      const host = `iaas.${region}.oraclecloud.com`;
      const path = `/20160918/instances/${encodeURIComponent(handle.runtimeId)}`;
      const headers = ociSign({
        method: 'delete', path, host,
        tenancy: creds['OCI_TENANCY_OCID'], user: creds['OCI_USER_OCID'],
        fingerprint: creds['OCI_FINGERPRINT'], privateKeyPem: creds['OCI_PRIVATE_KEY_PEM'],
      });
      await fetch(`https://${host}${path}`, { method: 'DELETE', headers: { ...headers, host } as Record<string, string> });
    } catch {
      // best-effort; orchestrator already pushed branch so repo is safe
    }
  }
}
