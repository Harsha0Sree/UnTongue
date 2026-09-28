# Deploy

## Local dev (Docker Compose for services + local Node for app)
1. `cp .env.example .env` and fill `GITHUB_CLIENT_ID/SECRET`, `CRED_ENC_KEY` (generate: `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`), `SESSION_SECRET`.
2. `mkdir -p data work`
3. `npm install`
4. `npm --workspace @untongue/provider-adapter run build`
5. `npm --workspace @untongue/api run build`
6. `PORT=8080 npm --workspace @untongue/api start` (serves API + `apps/web` static)
7. Worker (separate terminal or compose): polling loop runs inline in dev; for prod run `npm --workspace @untongue/worker start`.

## First real deployment: control plane on Oracle Always Free VM
Control plane is separate from agent execution and portable (DB file + env move hosts).

1. Launch A1 Flex (2 OCPU/12GB, Oracle Linux/Ubuntu, 50GB boot) in your **own** tenancy home region. Open port 8080 (or 443 via reverse proxy).
2. `sudo dnf install -y git nodejs` (or apt), `git clone <this repo>`, `cp .env.example .env` (prod values + strong secrets).
3. `npm install && npm --workspace @untongue/provider-adapter run build && npm --workspace @untongue/api run build && npm --workspace @untongue/worker run build`
4. Persist `./data` on block volume; snapshot before upgrades. To move hosts: stop, copy `./data` + `.env`, start on new host.
5. Run with systemd:
   - `untongue-api.service`: `ExecStart=/usr/bin/node /srv/apps/api/dist/server.js`
   - `untongue-worker.service`: `ExecStart=/usr/bin/node /srv/apps/worker/dist/worker.js`
6. Put Caddy/Nginx in front for TLS. Never expose `opencode serve` ports directly - only via per-job JWT proxy (MVP binds 127.0.0.1).

## Agent runtimes (user-owned)
- Oracle BYOM: each user pastes OCI API key + tenancy/region/compartment (or BYO host IP + SSH key) in UI; app launches A1 in **their** tenancy.
- Codespaces: user signs in with GitHub (`repo codespace read:user`); app creates codespaces on their behalf against their quota.
- Repo is source of truth: every job pushes `agent/<jobId>-...` branch for review.
