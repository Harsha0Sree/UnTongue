declare module 'node:sqlite' {
  export class DatabaseSync {
    constructor(path: string);
    exec(sql: string): void;
    prepare(sql: string): StatementSync;
    close(): void;
  }
  export class StatementSync {
    run(...params: unknown[]): { changes: number | bigint };
    get(...params: unknown[]): Record<string, unknown> | undefined;
    all(...params: unknown[]): Record<string, unknown>[];
  }
}

declare module '@opencode/sdk' {
  export const OpenCode: {
    create: (o?: unknown) => Promise<{
      sessions: {
        create: (a: unknown) => Promise<{ id: string; projectID?: string }>;
        prompt: (a: unknown) => Promise<void>;
      };
      close: () => Promise<void>;
    }>;
  };
}
