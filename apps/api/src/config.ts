export const config = {
  port: Number(process.env.PORT ?? 8080),
  dataDir: process.env.DATA_DIR ?? './data',
  dbPath: process.env.DATABASE_PATH ?? './data/control.db',
  workRoot: process.env.WORK_ROOT ?? './work',
  sessionSecret: process.env.SESSION_SECRET ?? 'dev-secret-change-me',
  credEncKeyB64: process.env.CRED_ENC_KEY ?? '',
  github: {
    clientId: process.env.GITHUB_CLIENT_ID ?? '',
    clientSecret: process.env.GITHUB_CLIENT_SECRET ?? '',
    callbackUrl: process.env.GITHUB_CALLBACK_URL ?? 'http://localhost:8080/api/auth/github/callback',
  },
};

export function requireEnvForProd(): string[] {
  if (process.env.NODE_ENV === 'production') {
    const missing: string[] = [];
    if (!process.env.CRED_ENC_KEY) missing.push('CRED_ENC_KEY');
    if (!process.env.SESSION_SECRET) missing.push('SESSION_SECRET');
    if (!process.env.GITHUB_CLIENT_ID) missing.push('GITHUB_CLIENT_ID');
    if (!process.env.GITHUB_CLIENT_SECRET) missing.push('GITHUB_CLIENT_SECRET');
    return missing;
  }
  return [];
}
