# Transcript browser regressions

The transcript is the package's flagship surface and its renderer stack
is owned code. This suite renders the showcase bench
(`fixtures/transcript/` — every transcript component in the adopted
register over canned content, no backend) in light and dark at the
companion drawer's narrow width, and pins the pixels — a token change, a
dependency bump, or a renderer edit that moves the transcript diffs a
committed baseline. Font-independent interaction probes exercise browser
geometry and scroll behavior against the same real components.

- Run: `npm run test:screenshot` (Playwright starts the fixture server
  itself; that server also builds the element bundle, so a freshly started
  server serves the current `dist/element/assistant.js`). Caveat:
  `reuseExistingServer: true` means an already-running fixture server is
  reused as-is and NO build runs — esbuild's servedir serves whatever
  `dist/element/` is on disk, possibly stale or absent; restart the server
  after pulling changes or editing sources. Both reuse hazards fail closed:
  an absent artifact gets the probe's named diagnosis (visible page text and
  `body[data-probe-error]`, "restart `npm run fixture:transcript`"), and a
  stale one is caught by the suite's freshness guard, which rehashes the
  build manifest's recorded inputs (`dist/element-build-manifest.json`,
  written by `build:element`) against the tree. CI never reuses a server (the
  container starts clean).
- Baselines are **Linux renders** — font rasterization differs per OS, so
  the two screenshot tests skip off Linux rather than diff across
  rasterizers. Font-independent browser interaction regressions in the same
  suite run on every platform. CI (`checks.yml`, the Assistant Package job)
  runs the complete suite with the recipe below, unchanged, over the exported
  mirror tree mounted as `/work` — so the container sees exactly what the
  public mirror receives.

## Regenerating baselines

From the package root, in the Playwright container (match the version to the
`@playwright/test` devDependency):

```sh
docker run --rm -v "$PWD":/work mcr.microsoft.com/playwright:v1.63.0-noble /bin/bash -lc '
  cp -r /work /tmp/pkg &&
  rm -rf /tmp/pkg/node_modules /tmp/pkg/fixtures/*/out /tmp/pkg/tests-e2e/results &&
  cd /tmp/pkg && npm ci &&
  npx playwright test --update-snapshots &&
  for d in tests-e2e/*-snapshots; do
    rm -rf "/work/$d" &&
    cp -r "$d" /work/tests-e2e/
  done
'
```

After regenerating, run the suite in the same container twice more
WITHOUT `--update-snapshots` — two consecutive green runs are the
stability bar before committing baselines (the shiki settle and any
readiness gate flake shows up here, not in CI).

Review the diff like any code change: the baselines are the transcript's
visual contract, and re-blessing them is a design decision, not a chore.
