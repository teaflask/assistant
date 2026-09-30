import { defineConfig } from "orval";

// The SSE stream endpoints stay hand-built (replay-stream-agent speaks
// them); a generated fetch function for either would be dead code with a
// lying type.
const SSE_STREAM_PATHS = new Set([
  "/serving/v1/assistant-threads/{thread_id}/stream",
  "/serving/v1/assistant-threads/{thread_id}/dispatches/{child_session_id}/stream",
]);

// The serving OpenAPI spec is not part of this repository: the caller
// names it, and there is no default path to reach for.
const target = process.env.SERVING_OPENAPI_SPEC;
if (target === undefined || target === "") {
  throw new Error(
    "SERVING_OPENAPI_SPEC is not set: the serving OpenAPI spec is not part " +
      "of this repository — point the variable at a serving-openapi.json to " +
      "regenerate src/generated",
  );
}

export default defineConfig({
  servingContract: {
    input: {
      target,
      override: {
        // The package speaks only the /serving/v1 plane; /help
        // belongs to the frontend's serving target.
        transformer: (spec) => ({
          ...spec,
          paths: Object.fromEntries(
            Object.entries(spec.paths ?? {}).filter(
              ([path]) =>
                path.startsWith("/serving/v1") && !SSE_STREAM_PATHS.has(path),
            ),
          ),
        }),
      },
    },
    output: {
      target: "src/generated/serving.ts",
      schemas: "src/generated/models",
      client: "fetch",
      httpClient: "fetch",
      clean: true,
      formatter: "prettier",
      override: {
        mutator: {
          path: "src/transport/serving-fetch.ts",
          name: "servingFetch",
        },
        fetch: { includeHttpResponseReturnType: false },
      },
    },
  },
});
