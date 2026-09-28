import type { Eligibility, FreeLimits, ProviderAdapter, ProvisionRequest, QuotaSnapshot, RuntimeHandle } from './types.js';
import { AdapterError } from './types.js';

const INFO: FreeLimits & { planName: string } = {
  planName: 'GitHub Codespaces (user-owned quota)',
  summary: 'Codespaces are billed to the user/owner; free allowance depends on account type and must be checked per user.',
  details: [
    'Created via REST API on behalf of the authenticated user; owned + billed to that user.',
    'Free allowance varies (e.g. personal-account monthly included hours/storage) - app checks per user, never assumes.',
    'Requires `codespace` scope (OAuth) plus repo access.',
    'Idle timeout + retention delete apply; work must be pushed to the branch before stop.',
  ],
  docsUrl: 'https://docs.github.com/en/rest/codespaces/codespaces',
  lastCheckedAt: '2026-09-28',
};

const API = 'https://api.github.com';

async function gh(token: string, path: string, init?: RequestInit) {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2026-03-10',
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
  });
  return res;
}

export class CodespacesAdapter implements ProviderAdapter {
  id = 'codespaces';
  kind = 'browser-workspace' as const;
  ownership = 'user-owned' as const;
  isPaid = false;
  info = INFO;

  async checkEligibility(ctx: { userCredentials: Record<string, string>; githubToken?: string }): Promise<Eligibility> {
    const token = ctx.githubToken ?? ctx.userCredentials['GITHUB_TOKEN'];
    if (!token) return { eligible: false, reason: 'GitHub not connected. Sign in with GitHub first.', limits: INFO };
    try {
      // Real check: can the user list codespaces? Then inspect quota via billable usage where visible.
      const res = await gh(token, '/user/codespaces?per_page=1');
      if (res.status === 401 || res.status === 403) {
        return { eligible: false, reason: 'GitHub token rejected or missing `codespace` scope. Reconnect with codespace permission.', limits: INFO };
      }
      if (!res.ok) {
        return { eligible: false, reason: `GitHub API ${res.status}. Retry later.`, limits: INFO };
      }
      return { eligible: true, reason: 'GitHub reachable with codespace scope. Free balance depends on your account/billing - checked at create time.', limits: INFO, quotaRemaining: 'per-user; see GitHub billing' };
    } catch (e) {
      return { eligible: false, reason: `Could not reach GitHub (${(e as Error).message}).`, limits: INFO };
    }
  }

  async getQuotas(_creds: Record<string, string>, githubToken?: string): Promise<QuotaSnapshot> {
    const token = githubToken ?? _creds['GITHUB_TOKEN'];
    if (!token) {
      return { providerId: this.id, remaining: null, exhausted: false, checkedAt: new Date().toISOString(), source: 'github-codespaces-api' };
    }
    try {
      const res = await gh(token, '/user/codespaces?per_page=100');
      const json = (await res.json()) as { total_count?: number };
      return {
        providerId: this.id,
        remaining: `active codespaces: ${json.total_count ?? 'unknown'} (free balance in GitHub billing)`,
        exhausted: false,
        checkedAt: new Date().toISOString(),
        source: 'github-codespaces-api',
      };
    } catch {
      return { providerId: this.id, remaining: null, exhausted: false, checkedAt: new Date().toISOString(), source: 'github-codespaces-api' };
    }
  }

  private parseRepo(repoUrl: string): { owner: string; repo: string } {
    const m = repoUrl.match(/github\.com[/:]([^/]+)\/([^/.]+)(\.git)?/);
    if (!m) throw new AdapterError('PROVISION_FAILED', `unsupported repo url: ${repoUrl}`);
    return { owner: m[1], repo: m[2] };
  }

  async provision(req: ProvisionRequest): Promise<RuntimeHandle> {
    const token = req.userCredentials['GITHUB_TOKEN'];
    if (!token) throw new AdapterError('AUTH_FAILED', 'GitHub token missing. Sign in with GitHub first.');
    const { owner, repo } = this.parseRepo(req.repoUrl);
    // Check defaults first (real eligibility gate per repo/user)
    const def = await gh(token, `/repos/${owner}/${repo}/codespaces/new?ref=${encodeURIComponent(req.branch)}`);
    if (def.status === 403) throw new AdapterError('NOT_ELIGIBLE', 'Codespaces not available for you on this repo (no access, no quota, or org policy).');
    if (def.status === 404) throw new AdapterError('PROVISION_FAILED', 'Repo not found or Codespaces not enabled for it.');
    const res = await gh(token, `/repos/${owner}/${repo}/codespaces`, {
      method: 'POST',
      body: JSON.stringify({
        ref: req.branch,
        machine: req.machine ?? undefined,
        idle_timeout_minutes: 30,
        retention_period_minutes: 2880,
        display_name: `untongue-${req.branch.slice(0, 40)}`,
      }),
    });
    if (res.status === 402 || res.status === 403) {
      throw new AdapterError('QUOTA_EXHAUSTED', 'Codespaces quota/billing blocked this create. Work is safe on its branch - switch to your Oracle VM or add Codespaces quota.');
    }
    if (res.status === 202 || res.status === 201) {
      const json = (await res.json()) as { name?: string; id?: number; web_url?: string };
      return { providerId: this.id, runtimeId: json.name ?? `cs-${json.id}`, endpoint: json.web_url, workDir: '/workspaces', meta: { owner, repo } };
    }
    const text = await res.text();
    throw new AdapterError('PROVISION_FAILED', `Codespaces create failed: ${res.status} ${text.slice(0, 300)}`);
  }

  async destroy(handle: RuntimeHandle, creds: Record<string, string>): Promise<void> {
    const token = creds['GITHUB_TOKEN'];
    if (!token) return;
    try {
      await gh(token, `/user/codespaces/${encodeURIComponent(handle.runtimeId)}`, { method: 'DELETE' });
    } catch {
      // best-effort; branch already pushed so repo is safe
    }
  }
}
