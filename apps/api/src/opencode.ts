import { spawn, type ChildProcess } from 'node:child_process';

/**
 * OpenCode runner.
 * Uses official V2 SDK (@opencode/sdk) in-process when installed,
 * else falls back to `opencode serve` CLI. Never fakes agent output.
 */
export interface OpencodeSession {
  sessionId: string;
  apiUrl: string;
  stop(): Promise<void>;
}

export async function startOpencode(opts: { workdir: string; port: number; model?: string }): Promise<OpencodeSession> {
  // 1) Try official SDK (V2): https://opencode.ai/v2/docs/build/sdk
  try {
    const mod = (await import('@opencode/sdk').catch(() => null)) as {
      OpenCode?: { create: (o?: unknown) => Promise<{ sessions: { create: (a: unknown) => Promise<{ id: string }>; prompt: (a: unknown) => Promise<void> }; close: () => Promise<void> }> };
    } | null;
    if (mod?.OpenCode) {
      const host = await mod.OpenCode.create();
      const session = await host.sessions.create({ location: { directory: opts.workdir } });
      return {
        sessionId: session.id,
        apiUrl: `sdk-inprocess:${session.id}`,
        stop: () => host.close(),
      };
    }
  } catch {
    // fall through to CLI
  }

  // 2) CLI fallback: real `opencode serve`, health-checked.
  const port = opts.port;
  const args = ['serve', '--port', String(port), '--hostname', '127.0.0.1'];
  let child: ChildProcess;
  try {
    child = spawn('opencode', args, { cwd: opts.workdir, stdio: 'pipe', env: { ...process.env, ...(opts.model ? { OPENCODE_MODEL: opts.model } : {}) } });
  } catch (e) {
    throw new Error(`opencode binary not found. Install OpenCode (https://opencode.ai/v2/docs) to run agents. (${(e as Error).message})`);
  }
  const apiUrl = `http://127.0.0.1:${port}`;
  const started = await waitForHealth(apiUrl, child);
  if (!started) {
    child.kill();
    throw new Error('opencode serve did not become healthy. Check `opencode --version` and workdir permissions.');
  }
  return {
    sessionId: `${Date.now().toString(36)}`,
    apiUrl,
    stop: async () => {
      child.kill();
    },
  };
}

async function waitForHealth(apiUrl: string, child: ChildProcess): Promise<boolean> {
  for (let i = 0; i < 40; i++) {
    if (child.exitCode !== null && child.exitCode !== 0) return false;
    try {
      const res = await fetch(`${apiUrl}/api/info`);
      if (res.ok) return true;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}
