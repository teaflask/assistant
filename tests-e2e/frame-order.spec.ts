/**
 * The rendering-update ordering premise under the rail settle re-pin's
 * fire-time gate: within one rendering update, requestAnimationFrame
 * callbacks run BEFORE ResizeObserver deliveries (HTML "update the
 * rendering": animation frame callbacks at step 14, resize
 * observations gathered and broadcast after layout at step 16). The
 * settle re-pin therefore CAN fire between a reader's summary
 * activation (armed on the click's capture phase) and the toggle's own
 * resize delivery — which is why the deferred write must re-read
 * readerToggleRef and skip while it is armed, leaving the ref for the
 * observer's toggle branch to consume. If an engine ever delivered
 * resize observations before animation frames, that gate would become
 * unreachable dead weight and this probe would say so first.
 */
import { expect, test } from "@playwright/test";

test("rAF callbacks run before ResizeObserver deliveries in the same rendering update (the settle re-pin premise)", async ({
  page,
}) => {
  const order = await page.evaluate(
    () =>
      new Promise<string>((resolve) => {
        const target = document.createElement("div");
        target.style.width = "10px";
        target.style.height = "10px";
        document.body.append(target);
        const seen: string[] = [];
        const observer = new ResizeObserver(() => {
          seen.push("resize-observer");
          observer.disconnect();
          resolve(seen.join(","));
        });
        // observe() queues an initial delivery for the next rendering
        // update; the rAF scheduled in the same task joins that update.
        observer.observe(target);
        requestAnimationFrame(() => {
          seen.push("animation-frame");
        });
      }),
  );
  expect(order).toBe("animation-frame,resize-observer");
});
