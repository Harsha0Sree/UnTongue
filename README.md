# UnTongue — free-first cloud OpenCode runners (user-owned runtimes)

Run OpenCode agents on users' Git repos while laptops are off. Free-first, paid opt-in.
Repo is the durable source of truth; VMs/containers are ephemeral.

## Quickstart (local)
```
cp .env.example .env   # fill GITHUB_CLIENT_ID/SECRET, CRED_ENC_KEY, SESSION_SECRET
mkdir -p data work
npm install
npm --workspace @untongue/provider-adapter run build
npm --workspace @untongue/api run build
PORT=8080 npm --workspace @untongue/api start
# open http://localhost:8080 (serves apps/web)
```
Worker polls `queued` jobs inline in dev; run separately in prod:
`npm --workspace @untongue/worker run build && npm --workspace @untongue/worker start`.

## Model
- **User-owned runtimes only.** Oracle: user connects own tenancy (or BYO host). Codespaces: created via GitHub API on the user's quota. No shared pool, no co-located untrusted code on one VM.
- **Concurrency:** orchestrator auto-creates `agent/<jobId>-<slug>-<rand>` + isolated `git worktree` per job. Agents are never asked to branch. Override requires explicit checkbox + warning, audit-logged.
- **Free-first + paid opt-in:** `/api/providers` shows limits, eligibility, docs URL, last-checked. Paid needs `paidConsent=true`. Quota-exhausted stops safely and suggests another provider.
- **OpenCode V2:** `@opencode/sdk` in-process when installed, else `opencode serve` CLI health-checked. Docs: https://opencode.ai/v2/docs/build/sdk

## Layout
- `packages/provider-adapter/` — `ProviderAdapter` interface + `oracle-byom` (real OCI signed REST), `codespaces` (real GitHub REST), `gcp-future` (honest stub).
- `apps/api/` — Express + node:sqlite control plane (portable `./data/control.db`), GitHub OAuth, jobs/orchestrator, encrypted creds (AES-256-GCM).
- `apps/worker/` — DB-polling queue (swap for BullMQ/Redis by replacing `claimNext`).
- `apps/web/` — static dashboard (providers + limits + last-checked, connect runtime, start job, logs/diff/push).
- `tests/` — concurrency, security, adapter contracts, quota, integration (live-creds only).
- `docs/` — `provider-matrix.md`, `free-limits.md`, `deploy.md`, `what-free-cannot-guarantee.md`.

## Tests
`npm test` (unit/contract) · `INTEGRATION=1 npm run test:integration` (requires real OCI + GitHub creds; proves no mocks).

## Honest limits
See `docs/what-free-cannot-guarantee.md`. $0 means no SLA, possible out-of-capacity, idle reclaim, and per-user allowances only.
