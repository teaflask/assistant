# Scroll stress bench

A Mac-only reproduction lane for the frozen native scroll range recorded in
the transcript scrollbar stale-compositor-node record. Not part of the
Playwright suite: it needs a pinned Chrome build and a real, windowed macOS
compositor.

```sh
npx @puppeteer/browsers install chrome@151.0.7922.171 --path ~/.cache/chrome-for-testing
npm run build   # dist/styles.css must carry the closed-disclosure rule
node fixtures/scroll-stress/run.mjs \
  --chrome "$HOME/.cache/chrome-for-testing/chrome/mac_arm-151.0.7922.171/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing" \
  --runs 20 --variant baseline
```

Two arms. `shipped` measures the tree as built. `baseline` injects an
override that rolls the shipped rule's one declaration back to the
engine's own closed-`<details>` treatment, so the untreated failure rate
stays measurable now that the rule ships; the runner refuses a run whose
arm did not take effect. One JSON line per run (a crashed run is an
`error` line), then a summary.

`--headless` runs without windows but does NOT reproduce the state (0 of
15 on a build that fails 65% headed): the compositor path differs. Only a
headed run counts, and a headed run opens a window every ~35s, so run it
on a machine nobody is working at.
