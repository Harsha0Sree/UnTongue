export type ProviderKind = 'vm' | 'browser-workspace' | 'container';
export type Ownership = 'user-owned';

export interface FreeLimits {
  summary: string;
  details: string[];
  docsUrl: string;
  lastCheckedAt: string; // ISO date
}

export interface Eligibility {
  eligible: boolean;
  reason: string;
  limits?: FreeLimits;
  quotaRemaining?: string;
}

export interface QuotaSnapshot {
  providerId: string;
  remaining: string | null;
  exhausted: boolean;
  checkedAt: string;
  source: string; // e.g. 'oci-limits-api' | 'github-codespaces-api'
}

export interface ProvisionRequest {
  userId: string;
  repoUrl: string;
  branch: string;
  machine?: string;
  userCredentials: Record<string, string>; // decrypted at call time, never logged
  paidConsent?: boolean;
}

export interface RuntimeHandle {
  providerId: string;
  runtimeId: string; // instance OCID or codespace name
  endpoint?: string;
  workDir: string; // remote workdir (informational; local isolation is enforced by orchestrator)
  meta: Record<string, string>;
}

export class AdapterError extends Error {
  code: 'NOT_IMPLEMENTED' | 'QUOTA_EXHAUSTED' | 'AUTH_FAILED' | 'PROVISION_FAILED' | 'NOT_ELIGIBLE';
  constructor(code: AdapterError['code'], message: string) {
    super(message);
    this.code = code;
  }
}

export interface ProviderAdapter {
  id: string;
  kind: ProviderKind;
  ownership: Ownership;
  isPaid: boolean;
  info: FreeLimits & { planName: string };
  checkEligibility(ctx: { userCredentials: Record<string, string>; githubToken?: string }): Promise<Eligibility>;
  provision(req: ProvisionRequest): Promise<RuntimeHandle>;
  destroy(handle: RuntimeHandle, userCredentials: Record<string, string>): Promise<void>;
  getQuotas(userCredentials: Record<string, string>, githubToken?: string): Promise<QuotaSnapshot>;
}
