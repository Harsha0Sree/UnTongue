# What $0 cannot guarantee (honest limits)

- **Capacity:** Oracle A1 free capacity is often full (`out of host capacity`). No queue-jumping; try another AD/region/time.
- **Idle reclaim:** Oracle may reclaim idle (<20% over 7d) instances; Codespaces idle-stop + retention delete. The repo branch is the durable store - always push.
- **Performance:** Free VMs are shared/burstable; expect slower builds, cold starts, egress limits (Oracle 10TB/mo outbound shared, Codespaces metered).
- **No SLA:** Free tiers have no uptime guarantee. Control plane itself runs on a single Oracle VM in MVP (back up `./data`).
- **One user = one allowance:** We do not pool free VMs across users. If you have no allowance left, we stop and suggest another provider - we will not create accounts or evade quotas.
- **Models:** Free model availability changes often; check provider docs + UI last-checked date before relying on a model.
