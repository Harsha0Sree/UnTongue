# Provider capability matrix (user-owned runtimes)

All runtimes are **user-owned**: each user connects their own account and consumes their own allowance.
The control plane never pools free capacity and never co-locates untrusted users on one shared VM.

| Provider | Kind | Ownership | Plan | Free limits (verify in linked docs) | Eligibility check | Last checked |
|---|---|---|---|---|---|---|
| `oracle-byom` | VM | user-owned | Oracle Always Free | A1 Flex 2 OCPUs/12GB total; E2 Micro x2; 200GB block+boot (home region); idle reclaim &lt;20% over 7d; out-of-capacity common | OCI API key valid + limits API reachable | 2026-09-28 |
| `codespaces` | browser-workspace | user-owned | GitHub Codespaces | Per-account included hours/storage; varies by plan; idle timeout + retention delete | `GET /repos/.../codespaces/new` + token scope `codespace` | 2026-09-28 |
| `oracle-paid` | VM | user-owned | Oracle paid (opt-in only) | Paid shapes in YOUR tenancy, billed to you. Hidden unless "Show paid" + `paidConsent=true`. | Same as oracle-byom + paid consent | 2026-09-28 |
| `gcp-future` | VM | user-owned | GCP free tier (planned) | e2-micro + 30GB + 1GB egress (planned adapter) | stub: always not-eligible | 2026-09-28 |

Docs:
- Oracle: https://docs.oracle.com/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm
- Codespaces API: https://docs.github.com/en/rest/codespaces/codespaces
- Fly.io excluded (trial: 2 VM-hours or 7 days): https://fly.io/docs/about/free-trial/
- OpenCode V2 SDK: https://opencode.ai/v2/docs/build/sdk

Paid: no paid provider is offered in MVP UI by default. Paid requires explicit `paidConsent=true` + user-owned billing credential. No auto-billing, trials, or overages.
