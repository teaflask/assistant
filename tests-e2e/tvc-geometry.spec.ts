/**
 * The geometry laws of the transcript visual contract
 * (docs/transcript-visual-contract.md §§1, 6), over the fixture
 * scenarios and the shared helpers. Every registered law runs here in
 * CI — there is no parked state (TVC-180). The selectors target the
 * components' stable hooks.
 */
import { expect, test, type Locator } from "@playwright/test";

import {
  bottomGapOf,
  contentXOriginOf,
  expectAlignedToMeasure,
  expectNoOverlap,
  expectOneIndentLevel,
  expectScrollUndisturbed,
  expectSharedXOrigin,
  expectStartsAtColumn,
  openScenario,
  settleTwoFrames,
  xOriginsOf,
} from "./helpers/geometry";

// One operation row's two columns, measured — the level step every
// hierarchy law is relative to.
const OPERATION_ROWS = "[data-tf-scenario-op]";
const OPERATION_ICONS = `${OPERATION_ROWS} summary > *:first-child`;
const OPERATION_LABELS = `${OPERATION_ROWS} summary > *:nth-child(2)`;

test("TVC-050 all first-level process icons share one x-origin", async ({
  page,
}) => {
  await openScenario(page, "operations");
  await expectSharedXOrigin(page.locator(OPERATION_ICONS));
});

test("TVC-051 all first-level process labels share one x-origin", async ({
  page,
}) => {
  await openScenario(page, "operations");
  await expectSharedXOrigin(page.locator(OPERATION_LABELS));
});

test("TVC-052 expanded technical detail begins under the label column, not the icon column", async ({
  page,
}) => {
  await openScenario(page, "operations");
  const row = page.locator(OPERATION_ROWS).first();
  await row.locator("summary").first().click();
  await settleTwoFrames(page);
  const labelOrigins = await xOriginsOf(page.locator(OPERATION_LABELS));
  // Precondition, not a guard: an empty label column must fail the law,
  // never satisfy it.
  expect(labelOrigins.length).toBeGreaterThan(0);
  // The expanded body is the tool-view slot (the bounded argument
  // reading on an untyped row) — no raw pane exists any more.
  await expectStartsAtColumn(
    row.locator("[data-tf-tool-view]").first(),
    labelOrigins[0],
  );
});

// TVC-040 (opening nested disclosures adds no cumulative left drift) was
// DELETED with the Technical details disclosure it measured: a tool row
// nests no disclosure of its own any more. TVC-041 below keeps the
// fold→row level. The id stays retired.

test("TVC-041 expanding a fold does not shift its process body by an extra group margin", async ({
  page,
}) => {
  await openScenario(page, "rhythm");
  // The settled fold: its expanded first row must share the fold
  // header's own x-origin — disclosure adds detail, not indentation.
  const settledGroup = page.locator("[data-tf-activity-group]").first();
  const header = settledGroup.locator("summary").first();
  await header.click();
  await settleTwoFrames(page);
  const headerBox = await header.boundingBox();
  const firstStep = settledGroup.locator("[data-tf-activity-step]").first();
  if (headerBox === null) {
    throw new Error("the fold header did not render");
  }
  await expectStartsAtColumn(firstStep, headerBox.x);
});

test("TVC-053 top-level prose and fold headers share the transcript x-origin", async ({
  page,
}) => {
  await openScenario(page, "rhythm");
  // Top-level prose only: rail paragraphs (reasoning text, panes) live
  // inside a fold's <details> — the settled fold is collapsed, so a
  // paragraph in there has no layout box, and it is not the transcript
  // prose this law aligns anyway.
  const prose = page
    .locator('[data-testid="scenario"] p:not(details p)')
    .first();
  const header = page.locator("[data-tf-activity-group] summary").first();
  const proseBox = await prose.boundingBox();
  if (proseBox === null) {
    throw new Error("the prose did not render");
  }
  await expectStartsAtColumn(header, proseBox.x);
});

test("TVC-060 a pending approval frame aligns to the transcript/composer measure", async ({
  page,
}) => {
  await openScenario(page, "approvals");
  const measure = page.locator('[data-testid="scenario"]');
  const cards = page.locator("[data-tf-approval-card]");
  // Precondition, not a guard: the decision surfaces must mark their
  // frames — a zero-card page must fail the law, never satisfy a
  // zero-iteration loop.
  await expect(cards).not.toHaveCount(0);
  for (const card of await cards.all()) {
    await expectAlignedToMeasure(card, measure);
  }
});

test("TVC-061 an elicitation frame aligns to the transcript/composer measure", async ({
  page,
}) => {
  await openScenario(page, "elicitations");
  const measure = page.locator('[data-testid="scenario"]');
  const cards = page.locator("[data-tf-elicitation-card]");
  // Precondition, not a guard (see TVC-060).
  await expect(cards).not.toHaveCount(0);
  for (const card of await cards.all()) {
    await expectAlignedToMeasure(card, measure);
  }
});

test("TVC-067 an oversized approval stays bounded: a giant consent prompt scrolls within the banner and never pushes the controls off screen", async ({
  page,
}) => {
  // The shelf-path successor to TVC-140's inline probe: a giant approval
  // arrives late THROUGH the suspension slot (the shipping composition).
  // The banner's surviving stressor is a very long backend-authored
  // consent sentence (the banner as a whole is the scroll region). 555px
  // is the narrow Brew viewport the original card defect shipped at.
  await page.setViewportSize({ width: 555, height: 859 });
  await page.goto(
    "http://127.0.0.1:8787/fixtures/transcript/?late-suspension-probe",
  );
  await page.getByRole("button", { name: "Render giant approval" }).click();
  const slot = page.locator("[data-tf-suspension-slot]");
  const card = slot.locator("[data-tf-approval-card]");
  await expect(card).toHaveCount(1);
  const well = slot.locator("[data-tf-decision-scroll-well]");
  const prompt = card.locator("[data-tf-approval-prompt]");
  // The prompt is never its own clipped scroll container: its full text
  // is laid out, and reaching it is the BANNER's one scroll journey.
  const promptBox = await prompt.evaluate((element) => ({
    clientHeight: element.clientHeight,
    scrollHeight: element.scrollHeight,
  }));
  expect(promptBox.clientHeight).toBeGreaterThanOrEqual(
    promptBox.scrollHeight - 1,
  );
  const viewportHeight = page.viewportSize()?.height ?? 0;
  expect(viewportHeight).toBeGreaterThan(0);
  // Precondition, not a guard: the banner is genuinely oversized — the
  // giant prompt overflows it, so the whole-banner scroll is exercised,
  // not vacuously green.
  const bannerOverflow = await card.evaluate((element) => ({
    scrollHeight: element.scrollHeight,
    clientHeight: element.clientHeight,
  }));
  expect(bannerOverflow.scrollHeight).toBeGreaterThan(
    bannerOverflow.clientHeight,
  );
  // The banner fits the tenant: it is capped 1rem below the well's own
  // budget, so the well grows no second scroll journey and no fold cue.
  const outerOverflow = await well.evaluate((element) => ({
    scrollHeight: element.scrollHeight,
    clientHeight: element.clientHeight,
  }));
  expect(outerOverflow.scrollHeight).toBeLessThanOrEqual(
    outerOverflow.clientHeight + 1,
  );
  const slotBox = await slot.boundingBox();
  if (slotBox === null) {
    throw new Error("the suspension slot did not render");
  }
  expect(slotBox.height).toBeLessThanOrEqual(viewportHeight * 0.5);
  await expect(well).not.toHaveAttribute("data-tf-fold-below");
  // The composer's controls stay fully on screen, un-overlapped.
  const composerBox = page.getByRole("textbox").first();
  await expect(composerBox).toBeVisible();
  await expectNoOverlap(slot, composerBox);
  const composerBounds = await composerBox.boundingBox();
  if (composerBounds === null) {
    throw new Error("the composer did not render");
  }
  expect(composerBounds.y + composerBounds.height).toBeLessThanOrEqual(
    viewportHeight + 1,
  );
  // Approve/Deny are reachable via the banner's OWN scroll — the giant
  // prompt pushed them below the banner's internal fold, never off the
  // page or under the composer.
  const approve = page.getByRole("button", { name: "Approve", exact: true });
  await card.evaluate((element) => {
    element.scrollTop = element.scrollHeight;
  });
  await expect(approve).toBeVisible();
  const approveBox = await approve.boundingBox();
  if (approveBox === null) {
    throw new Error("the consent controls did not render");
  }
  expect(approveBox.y).toBeGreaterThanOrEqual(0);
  expect(approveBox.y + approveBox.height).toBeLessThanOrEqual(
    viewportHeight + 1,
  );
  await expect(well).not.toHaveAttribute("data-tf-fold-below");

  // THE CONSTRAINED HOSTS (rounds 3+4): the palette caps its panel at
  // min(100dvh − 192px, 576px) with overflow-hidden, the companion card
  // at min(68dvh, 832px, 100dvh − 96px) — the probes write the real
  // formulas' rem terms as px (identical at the harness's 16px root) —
  // hosts where a bound that ignores the panel's own height clips the
  // composer off its bottom edge: the defect class this milestone
  // exists to remove, and one the full-viewport scene above can never
  // observe. Each host scene wears its REAL hook and REAL height
  // formula, and runs at a tall AND a SHORT viewport — the short case
  // is where a bare-rem override bites (round-4 finding; the round-3
  // probe ran only at full height, so its arithmetic held at exactly
  // one viewport).
  for (const probeHost of ["constrained", "floating"] as const) {
    for (const size of [
      { width: 672, height: 1400 },
      { width: 672, height: 420 },
    ]) {
      await page.setViewportSize(size);
      await page.goto(
        `http://127.0.0.1:8787/fixtures/transcript/?late-suspension-probe=${probeHost}`,
      );
      await page.getByRole("button", { name: "Render giant approval" }).click();
      const panel = page.locator('[data-testid="late-suspension-probe"]');
      const hostWell = panel.locator("[data-tf-decision-scroll-well]");
      await expect(panel.locator("[data-tf-approval-card]")).toHaveCount(1);
      const panelBox = await panel.boundingBox();
      if (panelBox === null) {
        throw new Error(`the ${probeHost} panel did not render`);
      }
      const hostComposer = page.getByRole("textbox").first();
      await expect(hostComposer).toBeVisible();
      await expectNoOverlap(hostWell, hostComposer);
      const composerInPanel = await hostComposer.boundingBox();
      if (composerInPanel === null) {
        throw new Error(`the ${probeHost} composer did not render`);
      }
      // Fully inside the overflow-hidden panel: the well yielded instead
      // of clipping the composer off the panel's bottom edge.
      expect(
        composerInPanel.y + composerInPanel.height,
        `${probeHost} host at ${String(size.height)}px viewport`,
      ).toBeLessThanOrEqual(panelBox.y + panelBox.height + 1);
    }
  }

  // THE QUESTION PANEL on every shelf host, tall and short, at its worst
  // case (the fixture's long set: a 500-char prompt, a failure sentence,
  // eight described suggestions). The ladder under test: the well never
  // scrolls (the panel is bounded to the well's budget minus 1rem), the
  // answer list scrolls first, and once the list has nothing left to give
  // the PANEL scrolls as a whole — so the Cancel/Submit footer is always
  // reachable inside the host, never laid out past the panel's edge into
  // the overflow-hidden host bottom. Watched red first with the panel's
  // overflow-y forced back to visible: on the 420px-tall hosts the well
  // grew a scroll journey of its own and the footer sat below the panel's
  // bottom edge.
  for (const probeHost of ["page", "constrained", "floating"] as const) {
    for (const size of [
      { width: 672, height: 1400 },
      { width: 672, height: 420 },
    ]) {
      await page.setViewportSize(size);
      await page.goto(
        `http://127.0.0.1:8787/fixtures/transcript/?late-suspension-probe=${probeHost}`,
      );
      await page
        .getByRole("button", { name: "Render long question set" })
        .click();
      const hostPanel = page.locator('[data-testid="late-suspension-probe"]');
      const hostWell = hostPanel.locator("[data-tf-decision-scroll-well]");
      const questionPanel = hostPanel.locator("[data-tf-question-panel]");
      await expect(questionPanel).toHaveCount(1);
      const label = `${probeHost} host at ${String(size.height)}px viewport`;
      // No well-level scroll journey: the panel fits the well's budget.
      // The one stated exception is the panel's own unshrinkable chrome
      // (2rem padding + the hairline border): at the palette's extreme
      // floor (a 420px-tall viewport leaves the well 20px) the chrome
      // alone overshoots, and the composer keeps priority by the host's
      // own construction — the fallback below still reaches the footer.
      const PANEL_CHROME_PX = 34;
      const wellOverflow = await hostWell.evaluate((element) => ({
        scrollHeight: element.scrollHeight,
        clientHeight: element.clientHeight,
      }));
      expect(
        wellOverflow.scrollHeight - wellOverflow.clientHeight,
        label,
      ).toBeLessThanOrEqual(PANEL_CHROME_PX);
      // The suggestions stay reachable: the list never collapses below
      // its 6rem floor (two answer rows), even when the panel itself has
      // become the scroller.
      const listHeight = await questionPanel
        .locator("[data-tf-question-answers]")
        .evaluate((element) => element.clientHeight);
      expect(listHeight, label).toBeGreaterThanOrEqual(95);
      // The footer is reachable inside the host: either in view already,
      // or after the panel's own fallback scroll.
      const cancel = questionPanel.getByRole("button", {
        name: "Cancel",
        exact: true,
      });
      await questionPanel.evaluate((element) => {
        element.scrollTop = element.scrollHeight;
      });
      const hostBox = await hostPanel.boundingBox();
      const cancelBox = await cancel.boundingBox();
      if (hostBox === null || cancelBox === null) {
        throw new Error(`the ${label} did not render its footer`);
      }
      expect(cancelBox.y, label).toBeGreaterThanOrEqual(hostBox.y - 1);
      expect(cancelBox.y + cancelBox.height, label).toBeLessThanOrEqual(
        hostBox.y + hostBox.height + 1,
      );
      // The composer survives beneath it, un-overlapped and inside the
      // host. Named, not `.first()`: the panel's own custom-answer
      // textarea is a textbox earlier in document order.
      const hostComposer = page.getByRole("textbox", { name: /^Message/ });
      await expect(hostComposer).toBeVisible();
      await expectNoOverlap(hostWell, hostComposer);
      const composerBox = await hostComposer.boundingBox();
      if (composerBox === null) {
        throw new Error(`the ${label} composer did not render`);
      }
      expect(composerBox.y + composerBox.height, label).toBeLessThanOrEqual(
        hostBox.y + hostBox.height + 1,
      );
    }
  }
});

test("TVC-070 a subagent child transcript indents exactly one rail level beyond its parent", async ({
  page,
}) => {
  // The level step is MEASURED off the operations rail — the icon
  // column to label column delta — never a hard-coded pixel count.
  await openScenario(page, "operations");
  const iconOrigins = await xOriginsOf(page.locator(OPERATION_ICONS));
  const labelOrigins = await xOriginsOf(page.locator(OPERATION_LABELS));
  // Preconditions, not guards: an empty rail must fail the law.
  expect(iconOrigins.length).toBeGreaterThan(0);
  expect(labelOrigins.length).toBeGreaterThan(0);
  const levelStep = labelOrigins[0] - iconOrigins[0];
  expect(levelStep).toBeGreaterThan(0);
  await openScenario(page, "subagents");
  const group = page.locator("[data-tf-subagent-group]");
  const child = page.locator("[data-tf-subagent-entry]");
  // Preconditions, not guards: both levels must be marked — a
  // missing hook fails here fast instead of hanging on boundingBox.
  await expect(group).not.toHaveCount(0);
  await expect(child).not.toHaveCount(0);
  const groupBox = await group.first().boundingBox();
  const childBox = await child.first().boundingBox();
  if (groupBox === null || childBox === null) {
    throw new Error("the subagent group did not render");
  }
  expectOneIndentLevel(groupBox.x, childBox.x, levelStep);
});

test("TVC-074 a subagent row's metadata lines share the label's x-origin", async ({
  page,
}) => {
  // The metadata lines (current work, duration, failure note) belong to
  // the label they annotate — a static padding cannot say so, because
  // the status+identity cluster's width stays stable across color
  // variants. Measured per row on the CONTENT x-origin
  // (contentXOriginOf): the law's own negative control proved a
  // border-box read is a no-op against a padding regression.
  await openScenario(page, "subagents");
  const entries = page.locator("[data-tf-subagent-entry]");
  // Precondition, not a guard: an empty tree must fail the law, and the
  // scenario must carry at least one row per metadata kind.
  await expect(entries).not.toHaveCount(0);
  // The current-work hook rides the shimmer's stacked children, so a
  // bare selector matches TWICE (base + aria-hidden highlight, one
  // x-origin) — which would pad the anti-vacuity floor below (round 3).
  // Scoping it to the base copy counts each LINE exactly once.
  const metadataHooks =
    "[data-tf-shimmer-base] [data-tf-subagent-current-work], [data-tf-subagent-worked], [data-tf-subagent-note]";
  let measuredLines = 0;
  for (const entry of await entries.all()) {
    const labelX = await contentXOriginOf(
      entry.locator("[data-tf-subagent-label]").first(),
    );
    for (const line of await entry.locator(metadataHooks).all()) {
      const lineX = await contentXOriginOf(line);
      expect(Math.abs(lineX - labelX)).toBeLessThanOrEqual(1);
      measuredLines += 1;
    }
  }
  // SETUP extension (round 5): the ROSTER rows are subagent rows too,
  // and the sibling surface regressed on the axis this law pins for the
  // inline row — sweep its lines against its labels as well. The
  // roster's duration rides INSIDE the status line ("Finished · 41s"),
  // so the LINE'S leading element carries the line's x-origin; note and
  // failure notes are lines of their own. Successful result summaries
  // deliberately do not render in either compact surface.
  await page.getByRole("button", { name: /Subagents:/ }).focus();
  const rosterRows = page.locator("[data-tf-subagent-disclosure] li li");
  await expect(rosterRows).not.toHaveCount(0);
  const rosterLineHooks = "[data-tf-subagent-status], [data-tf-subagent-note]";
  for (const row of await rosterRows.all()) {
    const labelX = await contentXOriginOf(
      row.locator("[data-tf-subagent-label]").first(),
    );
    for (const line of await row.locator(rosterLineHooks).all()) {
      const lineX = await contentXOriginOf(line);
      expect(Math.abs(lineX - labelX)).toBeLessThanOrEqual(1);
      measuredLines += 1;
    }
  }
  // The inline scenario's three rows carry exactly four metadata lines —
  // the running child's current work, the failed child's worked + note,
  // and the completed child's worked — and the roster's three rows add
  // three status lines and one note: eight in all. A
  // sweep that measured fewer lost a specimen; a floor padded by
  // duplicate hook matches is a weaker law than it reads (the round-3
  // audit).
  expect(measuredLines).toBeGreaterThanOrEqual(8);
});

test("TVC-075 a subagent row's ornaments center on the label line, never the whole stack", async ({
  page,
}) => {
  // The vertical alignment shape: a row grows extra lines and a
  // fixed-size ornament stays centered against the STACK, sliding off
  // the label it belongs to. The x-origin law above measures only the
  // horizontal axis; this law is the vertical one, over BOTH sibling
  // surfaces.
  await openScenario(page, "subagents");
  const centerYOf = async (subject: Locator): Promise<number> => {
    const box = await subject.boundingBox();
    if (box === null) {
      throw new Error("an ornament or label did not render");
    }
    return box.y + box.height / 2;
  };
  // The inline rows: the status+identity cluster rides the label line.
  const entries = page.locator("[data-tf-subagent-entry]");
  await expect(entries).not.toHaveCount(0);
  let measuredRows = 0;
  for (const entry of await entries.all()) {
    const cluster = await centerYOf(
      entry.locator("[data-tf-subagent-ornaments]").first(),
    );
    const label = await centerYOf(
      entry.locator("[data-tf-subagent-label]").first(),
    );
    expect(Math.abs(cluster - label)).toBeLessThanOrEqual(1);
    measuredRows += 1;
  }
  // The roster rows: identity tile and chevron ride the label line. The
  // scenario's pill opens on keyboard focus (TVC-125's own posing).
  await page.getByRole("button", { name: /Subagents:/ }).focus();
  const rosterRows = page.locator("[data-tf-subagent-disclosure] li li");
  await expect(rosterRows).not.toHaveCount(0);
  for (const row of await rosterRows.all()) {
    const label = await centerYOf(
      row.locator("[data-tf-subagent-label]").first(),
    );
    const tile = await centerYOf(
      row.locator("[data-tf-subagent-identity]").first(),
    );
    expect(Math.abs(tile - label)).toBeLessThanOrEqual(1);
    const chevron = row.locator(".lucide-chevron-right").first();
    if ((await chevron.count()) > 0) {
      expect(Math.abs((await centerYOf(chevron)) - label)).toBeLessThanOrEqual(
        1,
      );
    }
    measuredRows += 1;
  }
  // Anti-vacuity: three inline rows and three roster rows today.
  expect(measuredRows).toBeGreaterThanOrEqual(6);
});

test("TVC-076 the drill-in popover crosses the shadow boundary under a strict CSP", async ({
  page,
}) => {
  // The script-tag shadow root is the shipped widget's NORMAL habitat,
  // and "same shell as the roster's" is measured here, never derived.
  // The probe page's CSP is `style-src 'none'` (styling only via the
  // adopted constructed sheet; placement writes are CSSOM, which CSP
  // does not govern), and the popover mounts inside an open shadow
  // root, where document-level event targets retarget to the host — the
  // composedPath idiom under test. Explicit width: the suite's default
  // viewport is the drawer's narrow 390 (playwright.config.ts), where
  // placement takes the vertical branch — the beside-the-anchor
  // arithmetic asserted below is the full-page branch.
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("http://127.0.0.1:8787/fixtures/transcript/shadow-probe/");
  await expect(page.locator('body[data-probe-ready="true"]')).toBeAttached();
  // The probe group is settled (TVC-102 owns the page's one spinner) and
  // starts closed — open it first.
  await page.locator("[data-tf-subagent-group] summary").click();
  const opener = page.locator("button[data-tf-subagent-entry]").first();
  await opener.click();
  const popover = page.locator("[popover=manual]");
  await expect(popover).toBeVisible();
  // Top layer for real: the popover promotion must survive the shadow
  // boundary.
  expect(
    await popover.evaluate((element) => element.matches(":popover-open")),
  ).toBe(true);
  // The native full-row opener spans the transcript, so placement takes
  // the vertical branch and centers on it. CSSOM sizing must survive CSP.
  const anchorBox = await opener.boundingBox();
  const popoverBox = await popover.boundingBox();
  if (anchorBox === null || popoverBox === null) {
    throw new Error("the popover or its anchor did not render");
  }
  expect(
    Math.abs(
      popoverBox.x - (anchorBox.x + (anchorBox.width - popoverBox.width) / 2),
    ),
  ).toBeLessThanOrEqual(1);
  expect(popoverBox.width).toBe(384);
  expect(popoverBox.y).toBeGreaterThanOrEqual(
    anchorBox.y + anchorBox.height + 8,
  );
  expect(popoverBox.y + popoverBox.height).toBeLessThanOrEqual(900);
  // A pointerdown INSIDE the popover must not dismiss it — inside a
  // shadow root the document listener sees the event retargeted to the
  // HOST, so only composedPath() can tell inside from outside (a
  // contains() implementation fails exactly here).
  await page.locator("[data-probe-preview-body]").click();
  await expect(popover).toBeVisible();
  // The native Escape listener rides the popover element itself and the
  // focus restore lands on the opener INSIDE the shadow root.
  await page.keyboard.press("Escape");
  await expect(popover).toHaveCount(0);
  const focusedLabel = await page.evaluate(() => {
    const host = document.getElementById("probe-host");
    const active = host?.shadowRoot?.activeElement ?? null;
    return active instanceof HTMLElement ? active.textContent : null;
  });
  expect(focusedLabel).toContain("Shadow task 0.");
  // Light dismissal from OUTSIDE the shadow root.
  await opener.click();
  await expect(page.locator("[popover=manual]")).toBeVisible();
  await page.locator("body").click({ position: { x: 4, y: 4 } });
  await expect(page.locator("[popover=manual]")).toHaveCount(0);
});

// Non-law sibling-surface coverage: the drill-in popover is a direct
// conversation-body child — exactly what the roster's defocus rule
// targets (activity-shelf-slot-contract.md §6, the landlord rule,
// deliberately untouched) — and the tail budget is capacity 1, so the two
// preview surfaces must never coexist. Measured over the shipped
// stylesheet on the real hook structure: the failure shape is the popover
// left mounted at filter blur(8px) + pointer-events none under the open
// roster.
test("opening the roster dismisses an open drill-in — one child preview surface at a time", async ({
  page,
}) => {
  // Both viewport extremes (round 6, the sibling lane's closing method):
  // the popover's placement branch differs per width — beside the row at
  // the full page, above/below on the narrow band — and the exclusion
  // must hold in both.
  for (const viewport of [
    { width: 1280, height: 900 },
    { width: 390, height: 860 },
  ]) {
    await page.setViewportSize(viewport);
    await page.goto(
      "http://127.0.0.1:8787/fixtures/transcript/?subagent-defocus-probe",
    );
    // The probe's group is settled and starts closed (round 5's collapse
    // arm needs it so) — open it first.
    await page.locator("[data-tf-subagent-group] summary").click();
    await page.locator("button[data-tf-subagent-entry]").first().click();
    const popover = page.locator("[popover=manual]");
    await expect(popover).toBeVisible();
    // Sanity while both COULD coexist: the popover is crisp and
    // interactive before the roster opens.
    await expect(popover).toHaveCSS("filter", "none");
    await page.locator("[data-tf-subagent-pill] button").hover();
    await expect(page.locator("[data-tf-subagent-disclosure]")).toBeVisible();
    // The drill-in is DISMISSED, never left blurred and inert under the
    // roster's defocus treatment.
    await expect(popover).toHaveCount(0);
  }
});

test("the visual gap between a subagent roster and child preview stays pointer-safe", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await openScenario(page, "subagents");
  const pill = page.locator("[data-tf-subagent-pill] button");
  await pill.hover();
  const roster = page.getByRole("dialog", { name: "Subagents" });
  await expect(roster).toBeVisible();
  await roster.locator("li button").first().hover();
  const preview = page.locator("[popover=manual]");
  await expect(preview).toBeVisible();

  const rosterBox = await roster.boundingBox();
  const previewBox = await preview.boundingBox();
  if (rosterBox === null || previewBox === null) {
    throw new Error("the roster or child preview did not render");
  }

  // Placement may flip, but on this wide viewport it remains horizontal.
  // Pause IN the eight-pixel visual gap: without the transparent bridge,
  // the pill wrapper receives pointerleave here and unmounts both layers.
  const y = Math.max(
    Math.min(
      rosterBox.y + rosterBox.height / 2,
      previewBox.y + previewBox.height - 2,
    ),
    previewBox.y + 2,
  );
  if (previewBox.x > rosterBox.x) {
    const rosterEdge = rosterBox.x + rosterBox.width;
    await page.mouse.move(rosterEdge - 2, y);
    await page.mouse.move((rosterEdge + previewBox.x) / 2, y, { steps: 8 });
    await page.waitForTimeout(300);
    await expect(roster).toBeVisible();
    await expect(preview).toBeVisible();
    await page.mouse.move(previewBox.x + 2, y, { steps: 8 });
  } else {
    const previewEdge = previewBox.x + previewBox.width;
    await page.mouse.move(rosterBox.x + 2, y);
    await page.mouse.move((rosterBox.x + previewEdge) / 2, y, { steps: 8 });
    await page.waitForTimeout(300);
    await expect(roster).toBeVisible();
    await expect(preview).toBeVisible();
    await page.mouse.move(previewEdge - 2, y, { steps: 8 });
  }
  await expect(roster).toBeVisible();
  await expect(preview).toBeVisible();
});

// Non-law hidden-anchor coverage (failure-mode ledger mode 15): the
// group's <details> auto-collapses when its last coworker settles,
// hiding the opener while the preview is up. Pointer collapses
// light-dismiss first, so the probe drives the toggle by KEYBOARD — the
// no-pointer path the auto-collapse also takes.
test("a collapsing group keeps its preview placed and hands focus to the summary", async ({
  page,
}) => {
  // Both viewport extremes (round 6): the last-good-placement hold and
  // the summary focus fallback are branch-independent, proven so.
  for (const viewport of [
    { width: 1280, height: 900 },
    { width: 390, height: 860 },
  ]) {
    await page.setViewportSize(viewport);
    await page.goto(
      "http://127.0.0.1:8787/fixtures/transcript/?subagent-defocus-probe",
    );
    const summary = page.locator("[data-tf-subagent-group] summary");
    await summary.click();
    await page.locator("button[data-tf-subagent-entry]").first().click();
    const popover = page.locator("[popover=manual]");
    await expect(popover).toBeVisible();
    const placedBox = await popover.boundingBox();
    if (placedBox === null) {
      throw new Error("the preview did not place");
    }
    // Collapse WITHOUT a pointer: focus the summary and toggle it.
    await summary.focus();
    await page.keyboard.press("Enter");
    await expect(
      page.locator("button[data-tf-subagent-entry]").first(),
    ).toBeHidden();
    await expect(popover).toBeVisible();
    // A re-place tick against a boxless anchor must keep the last
    // placement — never the all-zeros corner jump (~x=8). This probe
    // renders the group outside any MessageList, so the transcript's
    // closed-disclosure rule (styles.css, scoped to
    // [data-tf-message-list]) does not reach it: Chromium keeps the
    // collapsed content display-locked and the hidden button KEEPS its
    // rect. The stub is therefore load-bearing — it is what produces the
    // zero-rect world (jsdom, an anchor hidden by host CSS, a transcript
    // under the rule) — and the guard's contract stays zero box ⇒ hold
    // still.
    await page.evaluate(() => {
      const button = document.querySelector("button[data-tf-subagent-entry]");
      if (button !== null) {
        (
          button as { getBoundingClientRect: () => DOMRect }
        ).getBoundingClientRect = () => new DOMRect(0, 0, 0, 0);
      }
    });
    await page.evaluate(() => {
      window.dispatchEvent(new Event("resize"));
    });
    await settleTwoFrames(page);
    const heldBox = await popover.boundingBox();
    if (heldBox === null) {
      throw new Error("the preview vanished on the re-place tick");
    }
    expect(Math.abs(heldBox.x - placedBox.x)).toBeLessThanOrEqual(1);
    expect(Math.abs(heldBox.y - placedBox.y)).toBeLessThanOrEqual(1);
    // Escape with focus back in the popover: the hidden opener cannot
    // take focus (isConnected does not test visibility — the round-5
    // premise fix), so the group's visible summary receives it, never a
    // silent drop to <body>.
    await popover.click();
    await page.keyboard.press("Escape");
    await expect(popover).toHaveCount(0);
    const focusTarget = await page.evaluate(() => {
      const active = document.activeElement;
      return active === null
        ? "none"
        : `${active.tagName.toLowerCase()}${active.closest("[data-tf-subagent-group]") !== null ? "@group" : ""}`;
    });
    expect(focusTarget).toBe("summary@group");
  }
});

test("TVC-120 activity overlays never overlap composer controls", async ({
  page,
}) => {
  await openScenario(page, "composer");
  // Scroll the transcript into scrollback so the jump-to-latest
  // overlay appears above the live composer, then prove separation.
  const viewport = page.locator('[role="log"] > div').first();
  await viewport.evaluate((element) => {
    element.scrollTop = 0;
  });
  await settleTwoFrames(page);
  const jump = page.getByRole("button", { name: "Scroll to bottom" });
  await expect(jump).toBeVisible();
  await expectNoOverlap(jump, page.getByRole("textbox").first());
});

test("TVC-122 decisions stay in flow while compact activity floats above the composer without reserving a band", async ({
  page,
}) => {
  await openScenario(page, "activity-shelf");
  // Preconditions, not guards: every scene's shelf must resolve (the
  // populated pair plus the parked-on-subagents scene), the populated composition
  // must hold all three tenants (suspension placeholder, sibling specimen,
  // subagent pill), and the busy composer must show its stop button — a page where
  // any selector silently matches nothing must fail the law, never satisfy a
  // zero-iteration loop.
  const shelves = page.locator("[data-tf-activity-shelf]");
  await expect(shelves).toHaveCount(3);
  const populated = page
    .locator("section")
    .filter({ has: page.locator("[data-tf-suspension-placeholder]") });
  await expect(populated).toHaveCount(1);
  const items = populated.locator("[data-tf-shelf-item]");
  await expect(items).toHaveCount(3);
  const stop = populated.getByRole("button", { name: "Stop generating" });
  const textbox = populated.getByRole("textbox");
  await expect(stop).toBeVisible();
  // The geometry matrix: the same component contract at the contract's
  // three widths — 390 (narrow mobile / drawer), 672 (palette), 1280
  // (full page, exercising the measure's centering). The surfaces differ
  // only in the width they hand this column.
  for (const width of [390, 672, 1280]) {
    await page.setViewportSize({ width, height: 1400 });
    await settleTwoFrames(page);
    // The suspension tenant renders on the full transcript/composer
    // measure — never indented under a process label.
    await expectAlignedToMeasure(
      populated.locator("[data-tf-suspension-placeholder]"),
      populated.locator("[data-tf-composer-wash]"),
    );
    // The decision shelf ends exactly where the composer root begins:
    // compact activity must not insert an in-flow row between them.
    const suspensionBox = await populated
      .locator("[data-tf-suspension-slot]")
      .boundingBox();
    const shelfBox = await populated
      .locator("[data-tf-activity-shelf]")
      .boundingBox();
    const activityBox = await populated
      .locator("[data-tf-activity-slot]")
      .boundingBox();
    const composerRootBox = await populated
      .locator("[data-tf-composer-root]")
      .boundingBox();
    const washBox = await populated
      .locator("[data-tf-composer-wash]")
      .boundingBox();
    if (
      suspensionBox === null ||
      shelfBox === null ||
      activityBox === null ||
      composerRootBox === null ||
      washBox === null
    ) {
      throw new Error(
        "the decision shelf, overlay, or composer did not render",
      );
    }
    expect(suspensionBox.y + suspensionBox.height).toBeLessThanOrEqual(
      shelfBox.y + shelfBox.height + 1,
    );
    expect(
      Math.abs(shelfBox.y + shelfBox.height - composerRootBox.y),
    ).toBeLessThanOrEqual(1);
    expect(
      await populated
        .locator("[data-tf-activity-slot]")
        .evaluate((element) => getComputedStyle(element).position),
    ).toBe("absolute");
    expect(activityBox.y + activityBox.height).toBeLessThanOrEqual(
      composerRootBox.y + 1,
    );
    // The overlay floats above the whole shelf+composer seam (round-3
    // review: anchored to the composer alone, the pill sat ~36px over
    // the decision card's Approve/Deny row). With the suspension slot
    // populated, the overlay's box must end where the SHELF begins —
    // never over a decision tenant.
    expect(activityBox.y + activityBox.height).toBeLessThanOrEqual(
      shelfBox.y + 1,
    );
    const activityItemBox = await populated
      .locator("[data-tf-activity-slot] [data-tf-shelf-item]")
      .last()
      .boundingBox();
    if (activityItemBox === null) {
      throw new Error("the activity shelf item did not render");
    }
    // The compact pill breathes above the composer's visible slab while
    // its clearance lives at the end of the scrollable transcript.
    expect(
      washBox.y - (activityItemBox.y + activityItemBox.height),
    ).toBeGreaterThanOrEqual(16);
    // No shelf item intersects the composer's controls.
    for (const item of await items.all()) {
      await expectNoOverlap(item, textbox);
      await expectNoOverlap(item, stop);
    }
    // And no FLOATING item intersects the decision tenant: the consent
    // surface's Approve/Deny row is exactly what a zero-flow pill must
    // never cover (round-3 review). Scoped to the overlay's items — the
    // suspension placeholder is itself a shelf item and cannot be asked
    // not to overlap itself.
    for (const item of await populated
      .locator("[data-tf-activity-slot] [data-tf-shelf-item]")
      .all()) {
      await expectNoOverlap(
        item,
        populated.locator("[data-tf-suspension-placeholder]"),
      );
    }
  }
  // The empty shelf consumes no vertical space at all.
  const emptyShelfHeight = await page
    .locator("section")
    .filter({ hasText: "Empty shelf" })
    .locator("[data-tf-activity-shelf]")
    .evaluate((element) => element.getBoundingClientRect().height);
  expect(emptyShelfHeight).toBe(0);
  // A pill does not push the composer upward. The parked and empty
  // scenes share the same fixed-height composition and differ only by
  // whether compact activity is present.
  const composerOffsetIn = (testId: string) =>
    page.locator(`[data-testid="${testId}"]`).evaluate((element) => {
      const composer = element.querySelector("[data-tf-composer-root]");
      if (!(composer instanceof HTMLElement)) {
        throw new Error("the comparison scene has no composer root");
      }
      return (
        composer.getBoundingClientRect().top -
        element.getBoundingClientRect().top
      );
    });
  const parkedComposerOffset = await composerOffsetIn("parked-on-subagents");
  const emptyComposerOffset = await composerOffsetIn("empty-shelf");
  expect(
    Math.abs(parkedComposerOffset - emptyComposerOffset),
  ).toBeLessThanOrEqual(1);
});

test("TVC-123 the scroll-away activity indicator appears for a scrolled-away reader during live activity without moving their scroll position, and activating it returns them to the tail", async ({
  page,
}) => {
  await openScenario(page, "activity-shelf");
  const populated = page
    .locator("section")
    .filter({ has: page.locator("[data-tf-suspension-placeholder]") });
  const viewport = populated.locator('[role="log"] > div').first();
  // Precondition, not a guard: the transcript must genuinely scroll.
  const overflow = await viewport.evaluate(
    (element) => element.scrollHeight - element.clientHeight,
  );
  expect(overflow).toBeGreaterThan(100);
  await viewport.evaluate((element) => {
    element.scrollTop = 0;
  });
  await settleTwoFrames(page);
  // The merged affordance: the jump button wears the activity treatment
  // (the badge dot must resolve — the non-colour signal) and says so in
  // its accessible name, which keeps the dedicated "scroll to bottom"
  // wording.
  const indicator = populated.locator("[data-tf-scroll-away-activity]");
  await expect(indicator).toBeVisible();
  await expect(indicator).toHaveAccessibleName(/scroll to bottom/i);
  await expect(indicator).toHaveAccessibleName(/new activity/i);
  await expect(indicator.locator("[data-tf-working-dot]")).toHaveCount(1);
  // Its appearance never auto-scrolls the reader.
  await settleTwoFrames(page);
  expect(await viewport.evaluate((element) => element.scrollTop)).toBe(0);
  // And it floats clear of the composer's controls.
  await expectNoOverlap(indicator, populated.getByRole("textbox"));
  // Scrollback shows only the jump arrow; the pill is also unfocusable.
  const yieldedSlot = populated.locator("[data-tf-activity-slot]");
  await expect(yieldedSlot).toHaveCSS("visibility", "hidden");
  await expect(yieldedSlot).toHaveCSS("opacity", "0");
  // Activation is the reader's own return path to the tail.
  await indicator.click();
  await expect
    .poll(() => bottomGapOf(viewport), { timeout: 5_000 })
    .toBeLessThanOrEqual(1);
  await expect(populated.locator("[data-tf-scroll-away-activity]")).toHaveCount(
    0,
  );
  // The pill returns with the tail.
  await expect(yieldedSlot).toHaveCSS("opacity", "1");
  await expect(yieldedSlot).toHaveCSS("visibility", "visible");
});

test("TVC-124 shelf population and height changes never strand a pinned reader at the bottom nor move a scrolled-away one", async ({
  page,
}) => {
  await page.goto(
    "http://127.0.0.1:8787/fixtures/transcript/?activity-shelf-probe",
  );
  await expect(page.locator("pre.shiki")).toHaveCount(1);
  const viewport = page.locator('[role="log"] > div').first();
  // Preconditions, not guards: the transcript must genuinely scroll and
  // must start pinned.
  const overflow = await viewport.evaluate(
    (element) => element.scrollHeight - element.clientHeight,
  );
  expect(overflow).toBeGreaterThan(100);
  await expect
    .poll(() => bottomGapOf(viewport), { timeout: 5_000 })
    .toBeLessThanOrEqual(1);
  // Populating the shelf steals ~150px of viewport with no content
  // change — the resize class the follow library never observes. The
  // pinned reader must be returned to the bottom (Guard 1), with the
  // last content never stranded below an unreachable max scroll.
  await page.getByRole("button", { name: "Populate shelf" }).click();
  // Precondition: the growth tenant genuinely rendered.
  await expect(page.locator("[data-tf-probe-suspension]")).toBeVisible();
  await settleTwoFrames(page);
  await expect
    .poll(() => bottomGapOf(viewport), { timeout: 5_000 })
    .toBeLessThanOrEqual(1);
  // Collapsing back re-grows the viewport; the reader stays pinned.
  await page.getByRole("button", { name: "Empty shelf" }).click();
  await settleTwoFrames(page);
  await expect
    .poll(() => bottomGapOf(viewport), { timeout: 5_000 })
    .toBeLessThanOrEqual(1);
  // A scrolled-away reader is never moved by the same height change.
  await viewport.evaluate((element) => {
    element.scrollTop = 0;
  });
  await settleTwoFrames(page);
  await expectScrollUndisturbed(page, viewport, async () => {
    await page.getByRole("button", { name: "Populate shelf" }).click();
  });
});

test("TVC-125 a tenant's floating disclosure opens fully inside the viewport at the narrow contract width, and holds its position while a sibling shelf item changes size", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 1400 });
  await openScenario(page, "activity-shelf");
  const populated = page
    .locator("section")
    .filter({ has: page.locator("[data-tf-suspension-placeholder]") });
  const specimen = populated.locator("[data-tf-sibling-specimen]");
  // Preconditions, not guards: the sibling stimulus must exist in its
  // wide form, and the pill trigger must resolve, before anything is
  // proven about the roster.
  await expect(specimen).toHaveText(/the wide form/);
  const trigger = populated.getByRole("button", { name: /Subagents:/ });
  await expect(trigger).toBeVisible();
  // Hover opens the roster (the mouse then stays put: the toggle below
  // is driven programmatically so no pointerleave/blur closes it).
  await trigger.hover();
  const roster = populated.locator("[data-tf-subagent-disclosure]");
  await expect(roster).toBeVisible();
  const before = await roster.boundingBox();
  if (before === null) {
    throw new Error("the open roster has no box");
  }
  // Fully inside the viewport at the contract's narrowest width.
  expect(before.x).toBeGreaterThanOrEqual(0);
  expect(before.x + before.width).toBeLessThanOrEqual(390);
  // The sibling changes size — the specimen drops its wide suffix — and
  // the stimulus is proven to have engaged.
  await page.evaluate(() => {
    const toggle = document.querySelector<HTMLButtonElement>(
      '[data-testid="toggle-sibling-width"]',
    );
    if (toggle === null) {
      throw new Error("the sibling-width toggle did not render");
    }
    toggle.click();
  });
  await expect(specimen).not.toHaveText(/the wide form/);
  await settleTwoFrames(page);
  // The roster held: still open, and its box did not move.
  await expect(roster).toBeVisible();
  const after = await roster.boundingBox();
  if (after === null) {
    throw new Error("the roster lost its box after the sibling resized");
  }
  expect(Math.abs(after.x - before.x)).toBeLessThanOrEqual(1);
  expect(Math.abs(after.y - before.y)).toBeLessThanOrEqual(1);
});

test("TVC-121 opening or closing a disclosure never steals a scrolled-away reader's scroll position", async ({
  page,
}) => {
  await page.goto(
    "http://127.0.0.1:8787/fixtures/transcript/?scroll-guards-probe",
  );
  await expect(page.locator("pre.shiki")).toHaveCount(1);
  const viewport = page.locator('[role="log"] > div').first();
  // Precondition, not a guard: the transcript must genuinely scroll —
  // an unscrollable viewport holds any scrollTop trivially.
  const overflow = await viewport.evaluate(
    (element) => element.scrollHeight - element.clientHeight,
  );
  expect(overflow).toBeGreaterThan(100);
  // Move into scrollback, then toggle the tool row's disclosure — the
  // reader's position must hold through the height change.
  await viewport.evaluate((element) => {
    element.scrollTop = 0;
  });
  await settleTwoFrames(page);
  await expectScrollUndisturbed(page, viewport, async () => {
    await page.locator("summary").first().click();
  });
});

test("drill-in rows share a label column and preserve failure-note hit testing", async ({
  page,
}) => {
  await page.goto(
    "http://127.0.0.1:8787/fixtures/transcript/?subagent-defocus-probe",
  );
  await page.locator("[data-tf-subagent-group] summary").click();
  const rows = page.locator("button[data-tf-subagent-entry]");
  await expect(rows).toHaveCount(2);
  const geometry = await rows.evaluateAll((elements) =>
    elements.map((entry) => {
      const group = entry.closest("[data-tf-subagent-group]");
      const label = entry.querySelector("[data-tf-subagent-label]");
      if (group === null || label === null)
        throw new Error("Missing row geometry hooks");
      return {
        x: entry.getBoundingClientRect().x,
        groupX: group.getBoundingClientRect().x,
        labelX: label.getBoundingClientRect().x,
        overlay: getComputedStyle(entry, "::after").content,
      };
    }),
  );
  expect(Math.abs(geometry[0].labelX - geometry[1].labelX)).toBeLessThanOrEqual(
    1,
  );
  for (const entry of geometry) {
    expect(entry.x - entry.groupX).toBe(28);
    expect(entry.overlay).toBe("none");
  }
  const note = page
    .locator("button[data-tf-subagent-entry] [data-tf-subagent-note]")
    .first();
  await expect(note).toBeVisible();
  expect(
    await note.evaluate((element) => {
      const box = element.getBoundingClientRect();
      return document
        .elementFromPoint(box.x + 2, box.y + box.height / 2)
        ?.closest("[title]")
        ?.getAttribute("title");
    }),
  ).toBe(await note.getAttribute("title"));
  await note.click();
  await expect(page.locator("[popover=manual]")).toBeVisible();
});
