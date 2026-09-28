// Launcher: worker logic lives in apps/api/dist/worker.js (single build).
// Keeps control plane + queue in one portable unit.
await import('../../api/dist/worker.js');
