import { defineConfig } from "vitest/config";

// Node environment on purpose: the suite covers the transport layer's
// byte-level and stateful logic (SSE id scanning, resume snapshots, the
// overlap filter) — Node 22 ships fetch, Response, and TransformStream
// natively, so no DOM shim is needed.
export default defineConfig({
  test: { environment: "node", include: ["tests/**/*.test.{ts,tsx}"] },
});
