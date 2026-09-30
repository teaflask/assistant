// The scroll-stress runner: pins a Chrome build, plays the bench N times,
// and applies the oracle the live-tab diagnosis established — after the
// run settles, a SMOOTH scrollTo the DOM maximum and a keyboard End are
// routed to the compositor by element id and collapse onto a stale scroll
// node's frozen maximum, while an instant write reaches the true maximum.
// A run is STALE when both element-id probes miss the DOM maximum by the
// same value while the instant control succeeds.
//
//   node fixtures/scroll-stress/run.mjs --chrome "<path to binary>" --runs 50
//        [--variant baseline|shipped] [--headless] [--port 8797]
//
// `shipped` measures the tree as built (dist/styles.css carries the
// closed-disclosure rule); `baseline` injects an override that rolls that
// one declaration back to the engine's own closed-<details> treatment, so
// the untreated failure rate stays measurable after the rule shipped.
// Headed only in practice: headless does not reproduce, and the report
// says Linux is unaffected. Serves the bench itself on the given port
// through esbuild (kept alive on a pipe), so no other fixture server is
// touched.

import { spawn } from "node:child_process";
import { parseArgs } from "node:util";

import { chromium } from "@playwright/test";

const { values: args } = parseArgs({
  strict: true,
  options: {
    chrome: { type: "string" },
    runs: { type: "string", default: "10" },
    headless: { type: "boolean", default: false },
    variant: { type: "string", default: "baseline" },
    port: { type: "string", default: "8797" },
    "step-delay": { type: "string", default: "70" },
    "chunk-delay": { type: "string", default: "25" },
  },
});
const chromePath = args.chrome;
const runs = Number(args.runs);
const headless = args.headless;
const variant = args.variant;
const port = Number(args.port);
const stepDelayMs = Number(args["step-delay"]);
const chunkDelayMs = Number(args["chunk-delay"]);
if (chromePath === undefined) {
  console.error("--chrome <path> is required");
  process.exit(2);
}
const isCount = (n) => Number.isInteger(n) && n >= 0;
if (!isCount(runs) || runs < 1 || !isCount(port)) {
  console.error("--runs and --port must be integers");
  process.exit(2);
}
if (!isCount(stepDelayMs) || !isCount(chunkDelayMs)) {
  // A NaN delay collapses every sleep to 0ms — a different experiment
  // that would still print a rate.
  console.error("--step-delay and --chunk-delay must be non-negative integers");
  process.exit(2);
}

const SHIPPED_RULE =
  "[data-tf-message-list] details:not([open])::details-content";
const VARIANT_CSS = {
  shipped: "",
  // revert-layer rolls the shipped (unlayered) declaration back to the
  // previous cascade layer and, finding none for display, to the engine's
  // own closed-<details> treatment — the untreated tree.
  baseline: `${SHIPPED_RULE} { display: revert-layer; }`,
};
if (!(variant in VARIANT_CSS)) {
  console.error(`unknown variant ${variant}`);
  process.exit(2);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitForPort(url, timeoutMs) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch {
      // not up yet
    }
    await sleep(200);
  }
  throw new Error(`server at ${url} did not come up`);
}

let shuttingDown = false;
const server = spawn(
  "npx",
  [
    "esbuild",
    "fixtures/scroll-stress/main.tsx",
    "--bundle",
    "--jsx=automatic",
    "--loader:.woff=empty",
    "--loader:.woff2=empty",
    "--loader:.ttf=empty",
    "--outdir=fixtures/scroll-stress/out",
    "--servedir=.",
    `--serve=127.0.0.1:${String(port)}`,
  ],
  { stdio: ["pipe", "ignore", "inherit"] },
);
server.on("exit", (code) => {
  if (!shuttingDown) {
    console.error(
      `esbuild exited early (code ${String(code)}): wrong cwd (run from the package root) or port ${String(port)} in use`,
    );
    process.exit(1);
  }
});
const shutdown = () => {
  shuttingDown = true;
  server.kill();
};
process.on("exit", shutdown);

const origin = `http://127.0.0.1:${String(port)}`;
const base = `${origin}/fixtures/scroll-stress/`;
await waitForPort(base, 60_000);

// The bench is meaningless without the built sheet: no rail cap, no
// overflow panes, no rule under test.
const sheet = await fetch(`${origin}/dist/styles.css`);
const sheetText = sheet.ok ? await sheet.text() : "";
if (!sheet.ok || !sheetText.includes("::details-content")) {
  console.error(
    "dist/styles.css is missing or predates the closed-disclosure rule: run `npm run build` first",
  );
  shutdown();
  process.exit(1);
}

const browser = await chromium.launch({ executablePath: chromePath, headless });
const context = await browser.newContext({
  viewport: { width: 1512, height: 902 },
  deviceScaleFactor: 2,
});

const scrollTopOf = (page) =>
  page.evaluate(() => window.__stress.scroller().scrollTop);

/** Poll the offset until it holds for 500ms (smooth scrolls and keyboard
 *  scrolls both animate) or maxMs elapses. */
async function readStable(page, maxMs) {
  let last = -1;
  let stableSince = Date.now();
  const t0 = Date.now();
  let value = 0;
  while (Date.now() - t0 < maxMs) {
    value = await scrollTopOf(page);
    if (Math.abs(value - last) > 0.5) {
      last = value;
      stableSince = Date.now();
    } else if (Date.now() - stableSince > 500) {
      break;
    }
    await sleep(50);
  }
  return value;
}

async function parkAtTop(page) {
  await page.evaluate(() => {
    window.__stress.scroller().scrollTo({ top: 0, behavior: "instant" });
  });
  await sleep(150);
}

/** Layout quiescence: shiki and late re-renders can keep growing the
 *  content after play() resolves; wait until scrollHeight holds for 1s. */
const settleLayout = (page) =>
  page.evaluate(async () => {
    const s = window.__stress.scroller();
    const t0 = performance.now();
    let last = s.scrollHeight;
    let since = performance.now();
    while (performance.now() - t0 < 12_000) {
      await new Promise((r) => setTimeout(r, 100));
      if (s.scrollHeight !== last) {
        last = s.scrollHeight;
        since = performance.now();
      } else if (performance.now() - since > 1000) {
        break;
      }
    }
    return {
      settleMs: Math.round(performance.now() - t0),
      shiki: document.querySelectorAll("pre.shiki").length,
    };
  });

/** Focus the scroller through an inert paragraph — never a <summary>,
 *  whose toggle would change layout mid-probe. Chromium scrolls the
 *  scroller of the last clicked node on End. */
async function focusThroughProse(page) {
  const spot = await page.evaluate(() => {
    const s = window.__stress.scroller();
    const sr = s.getBoundingClientRect();
    const p = [...s.querySelectorAll("p")].find((el) => {
      const r = el.getBoundingClientRect();
      return (
        r.top > sr.top + 4 &&
        r.bottom < sr.bottom - 4 &&
        r.height > 8 &&
        el.closest("summary, a, button, pre, details") === null
      );
    });
    if (p === undefined) return null;
    const r = p.getBoundingClientRect();
    return { x: r.left + Math.min(24, r.width / 4), y: r.top + r.height / 2 };
  });
  if (spot === null) throw new Error("no inert paragraph to focus through");
  await page.mouse.click(spot.x, spot.y);
}

async function probeOnce(page, run) {
  await page.goto(base);
  if (VARIANT_CSS[variant] !== "") {
    await page.addStyleTag({ content: VARIANT_CSS[variant] });
  }
  await page.waitForFunction(() => typeof window.__stress === "object");
  await page.evaluate(
    ({ stepDelayMs, chunkDelayMs }) =>
      window.__stress.play({ stepDelayMs, chunkDelayMs }),
    { stepDelayMs, chunkDelayMs },
  );
  const settled = await settleLayout(page);
  const before = await page.evaluate(() => {
    const s = window.__stress.scroller();
    return { scrollTop: s.scrollTop, domMax: s.scrollHeight - s.clientHeight };
  });

  await parkAtTop(page);
  const smoothTarget = await page.evaluate(() => {
    const s = window.__stress.scroller();
    const target = s.scrollHeight - s.clientHeight;
    s.scrollTo({ top: target, behavior: "smooth" });
    return target;
  });
  const smoothLanding = await readStable(page, 4000);

  await parkAtTop(page);
  await focusThroughProse(page);
  await page.keyboard.press("End");
  const endLanding = await readStable(page, 4000);

  const instant = await page.evaluate(() => {
    const s = window.__stress.scroller();
    s.scrollTop = s.scrollHeight - s.clientHeight;
    return s.scrollTop;
  });
  const after = await page.evaluate(() => window.__stress.metrics());
  const domMax = after.domMax;
  const smoothMiss = Math.abs(smoothLanding - domMax) > 2;
  const endMiss = Math.abs(endLanding - domMax) > 2;
  const instantOk = Math.abs(instant - domMax) <= 2;
  const probesAgree = Math.abs(smoothLanding - endLanding) <= 2;
  const stale = smoothMiss && endMiss && probesAgree && instantOk;
  return {
    run,
    variant,
    stale,
    inconclusive: (smoothMiss || endMiss) && !stale,
    smoothTarget,
    smoothLanding,
    endLanding,
    instant,
    domMax,
    impliedStaleExtent: stale ? smoothLanding + after.clientHeight : null,
    scrollHeight: after.scrollHeight,
    clientHeight: after.clientHeight,
    details: after.details,
    closedDetails: after.closedDetails,
    hiddenClosedBodies: after.hiddenClosedBodies,
    scrollableNested: after.scrollableNested,
    followedToBottom: Math.abs(before.scrollTop - before.domMax) <= 2,
    beforeScrollTop: before.scrollTop,
    settleMs: settled.settleMs,
    shiki: settled.shiki,
  };
}

let staleCount = 0;
let inconclusiveCount = 0;
let errorCount = 0;
for (let run = 1; run <= runs; run += 1) {
  const page = await context.newPage();
  try {
    const record = await probeOnce(page, run);
    if (variant === "baseline" && record.hiddenClosedBodies !== 0) {
      throw new Error(
        `baseline override did not take: ${String(record.hiddenClosedBodies)} closed bodies still hidden`,
      );
    }
    if (
      variant === "shipped" &&
      record.hiddenClosedBodies !== record.closedDetails
    ) {
      throw new Error(
        `shipped rule not in effect: ${String(record.hiddenClosedBodies)} of ${String(record.closedDetails)} closed bodies hidden`,
      );
    }
    if (record.stale) staleCount += 1;
    if (record.inconclusive) inconclusiveCount += 1;
    console.log(JSON.stringify(record));
  } catch (error) {
    // A failed run is a datum, not the end of the batch.
    errorCount += 1;
    console.log(
      JSON.stringify({ run, variant, error: String(error).split("\n")[0] }),
    );
  } finally {
    await page.close().catch(() => undefined);
  }
}

// The rate is over runs that produced a verdict: a crashed run or one the
// arm guard rejected is an observation the lane never made, and counting
// it as clean would flatter the treated arm.
const observed = runs - errorCount;
console.log(
  JSON.stringify({
    summary: true,
    variant,
    chrome: chromePath,
    runs,
    observed,
    stale: staleCount,
    inconclusive: inconclusiveCount,
    errors: errorCount,
    rate: observed === 0 ? null : staleCount / observed,
  }),
);
await browser.close();
shutdown();
process.exit(0);
