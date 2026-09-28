async function api(path, opts = {}) {
  const res = await fetch(path, { ...opts, headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) } });
  const text = await res.text();
  try { return { status: res.status, json: JSON.parse(text) }; }
  catch { return { status: res.status, json: { raw: text } }; }
}

async function loadProviders() {
  const { json } = await api('/api/providers');
  const el = document.getElementById('providers');
  const showPaid = document.getElementById('show-paid')?.checked;
  if (!json.providers) { el.textContent = 'Sign in to check your quotas.'; return; }
  const list = json.providers.filter((p) => showPaid || !p.isPaid);
  el.innerHTML = list.map((p) => `
    <div class="card">
      <strong>${p.id}</strong>
      <span class="badge ${p.isPaid ? 'paid' : 'free'}">${p.isPaid ? 'PAID (opt-in)' : 'FREE-ELIGIBLE'}</span>
      <span class="badge">user-owned</span>
      <div>${p.summary}</div>
      <ul>${(p.details || []).map((d) => `<li>${d}</li>`).join('')}</ul>
      <div><small>Docs: <a href="${p.docsUrl}">${p.docsUrl}</a> · last-checked ${p.lastCheckedAt}</small></div>
      <div><small>Eligibility: ${p.eligibility.eligible ? '✅' : '❌'} ${p.eligibility.reason}</small></div>
      ${p.quotas ? `<div><small>Quota: ${JSON.stringify(p.quotas)}</small></div>` : ''}
    </div>`).join('');
}

async function connectRuntime() {
  const providerId = document.getElementById('rt-provider').value;
  let credentials = {};
  try { credentials = JSON.parse(document.getElementById('rt-creds').value || '{}'); } catch { alert('invalid JSON'); return; }
  const { status, json } = await api('/api/runtimes/connect', { method: 'POST', body: JSON.stringify({ providerId, credentials }) });
  alert(status === 200 ? 'connected (encrypted)' : `failed: ${json.error}`);
  loadProviders();
}

async function startJob() {
  const body = {
    repoUrl: document.getElementById('job-repo').value,
    task: document.getElementById('job-task').value,
    providerId: document.getElementById('job-provider').value,
    paidConsent: document.getElementById('paid-consent').checked,
    allowSharedBranch: document.getElementById('allow-shared').checked,
    sharedBranch: document.getElementById('shared-branch').value || undefined,
  };
  const { status, json } = await api('/api/jobs', { method: 'POST', body: JSON.stringify(body) });
  document.getElementById('job-result').innerHTML = `<pre>${JSON.stringify(json, null, 2)}</pre>`;
  if (status === 201) loadJobs();
}

async function loadJobs() {
  const { json } = await api('/api/jobs');
  const el = document.getElementById('jobs');
  el.innerHTML = (json.jobs || []).map((j) => `
    <div class="card">
      <strong>${j.id}</strong> · ${j.status} · ${j.provider_id} · <code>${j.branch}</code>
      <div>${j.task}</div>
      ${j.error ? `<div class="badge warn">${j.error}</div>` : ''}
      <div><button onclick="showJob('${j.id}')">Logs + diff</button> <button onclick="pushJob('${j.id}')">Push branch</button></div>
      <div id="detail-${j.id}"></div>
    </div>`).join('');
}

async function showJob(id) {
  const { json } = await api(`/api/jobs/${id}`);
  const d = await api(`/api/jobs/${id}/diff`);
  document.getElementById(`detail-${id}`).innerHTML = `<pre>${JSON.stringify(json.logs, null, 2).slice(0, 4000)}\n\nDIFF:\n${(d.json.diff || '').slice(0, 4000)}</pre>`;
}

async function pushJob(id) {
  const { json } = await api(`/api/jobs/${id}/push`, { method: 'POST', body: '{}' });
  alert(JSON.stringify(json));
  loadJobs();
}

loadProviders();
loadJobs();
