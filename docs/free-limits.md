# Free limits (shown in UI with docs URL + last-checked date)

## Oracle Always Free (per-tenancy, home region) - checked 2026-09-28
Source: https://docs.oracle.com/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm
- A1 Flex: 1,500 OCPU-hours + 9,000 GB-hours/mo (~2 OCPUs + 12GB). 1-2 instances.
- E2 Micro: up to 2 (1/8 OCPU, 1GB).
- 200GB block+boot combined; min boot 47-50GB.
- Idle reclaim if CPU/net/mem p95 <20% over 7 days.
- Out-of-host-capacity errors are normal for A1.

## GitHub Codespaces (per-user quota) - checked 2026-09-28
Source: https://docs.github.com/en/rest/codespaces/codespaces
- Owned + billed to the authenticated user / billable owner.
- Free allowance depends on account/plan; app checks `codespaces/new` + lists usage, never assumes free.
- Requires OAuth scope `codespace`. Idle stop + retention delete apply - push branch before stop.

## OpenCode models (free-only default)
- MVP offers only models documented as free by the provider (e.g. provider free tiers). The API rejects non-allowlisted models unless the user explicitly enables paid models with consent.
- Re-verify via `POST /api/providers/:id/reverify` and provider docs before long runs.

## What happens when free runs out
Status `quota-exhausted`: runtime stops safely, branch + worktree preserved, UI offers another eligible provider. No retries to evade quotas, no extra accounts.
