/**
 * The script-tag config surface, pure half: attributes parse with
 * warn-then-degrade on bad values, and the property bag resolves onto
 * <TeaflaskAssistant> props — including the distribution's navigation
 * tri-state (unset → full-page loads, null → capability absent,
 * function → the host's router).
 */
import { isValidElement } from "react";
import { describe, expect, it } from "vitest";

import { CompanionMarkImage } from "../src/components/companion-mark-image";

import {
  navigateByFullPageLoad,
  OBSERVED_PAGE_ELEMENT_ATTRIBUTES,
  parseElementConfig,
  parsePageElementConfig,
  resolveElementProps,
  resolvePageElementProps,
  type ElementAttributeReader,
  type ElementHostProps,
  type MountableElementConfig,
  type MountablePageElementConfig,
} from "../src/element/element-config";

function attributesOf(values: Record<string, string>): ElementAttributeReader {
  return {
    getAttribute: (name: string) => values[name] ?? null,
  };
}

function mountableConfig(): MountableElementConfig {
  return { publishableKey: "pk_test_element", warnings: [] };
}

function mountablePageConfig(): MountablePageElementConfig {
  return { publishableKey: "pk_test_page", warnings: [] };
}

describe("parseElementConfig", () => {
  it("reads nothing as an unmountable config with defaults intact", () => {
    const config = parseElementConfig(attributesOf({}));
    expect(config.publishableKey).toBeNull();
    expect(config.baseUrl).toBeUndefined();
    expect(config.mode).toBeUndefined();
    expect(config.corner).toBeUndefined();
    expect(config.hotkey).toBeUndefined();
    expect(config.warnings).toEqual([]);
  });

  it("treats an empty attribute value as absent", () => {
    const config = parseElementConfig(
      attributesOf({ "publishable-key": "", "base-url": "" }),
    );
    expect(config.publishableKey).toBeNull();
    expect(config.baseUrl).toBeUndefined();
  });

  it("maps the kebab attributes onto their props", () => {
    const config = parseElementConfig(
      attributesOf({
        "publishable-key": "pk_test_element",
        "base-url": "http://localhost:8000",
        mode: "dark",
        corner: "bottom-left",
        hotkey: "mod+j",
        "companion-mark-src": "https://cdn.test/mark.svg",
      }),
    );
    expect(config).toEqual({
      publishableKey: "pk_test_element",
      baseUrl: "http://localhost:8000",
      mode: "dark",
      corner: "bottom-left",
      hotkey: "mod+j",
      companionMarkSrc: "https://cdn.test/mark.svg",
      warnings: [],
    });
  });

  it('turns hotkey="false" into the disabling false, not a spec', () => {
    const config = parseElementConfig(attributesOf({ hotkey: "false" }));
    expect(config.hotkey).toBe(false);
  });

  it("warns and degrades an unrecognized mode and corner", () => {
    const config = parseElementConfig(
      attributesOf({ mode: "midnight", corner: "top-left" }),
    );
    expect(config.mode).toBeUndefined();
    expect(config.corner).toBeUndefined();
    expect(config.warnings).toHaveLength(2);
    expect(config.warnings[0]).toContain('mode "midnight"');
    expect(config.warnings[1]).toContain('corner "top-left"');
  });
});

describe("resolveElementProps", () => {
  it("turns companion-mark-src into the package's image mark, keyed by the URL", () => {
    const { props } = resolveElementProps(
      { ...mountableConfig(), companionMarkSrc: "https://cdn.test/mark.svg" },
      {},
    );
    const mark = props.companionMark;
    expect(isValidElement(mark)).toBe(true);
    if (!isValidElement<Record<string, unknown>>(mark)) {
      throw new Error("unreachable");
    }
    // The rendered img's alt/draggable and the load-failure fallback are
    // assistant-element.test.tsx's subject — they need a DOM.
    expect(mark.type).toBe(CompanionMarkImage);
    expect(mark.props.src).toBe("https://cdn.test/mark.svg");
    expect(mark.key).toBe("https://cdn.test/mark.svg");
  });

  it("leaves the companion mark unset without the attribute — the package flask", () => {
    const { props } = resolveElementProps(mountableConfig(), {});
    expect(props.companionMark).toBeUndefined();
  });

  it("defaults navigation to the full-page load when never assigned", () => {
    const { props } = resolveElementProps(mountableConfig(), {});
    expect(props.onNavigate).toBe(navigateByFullPageLoad);
  });

  it("treats an explicit null as a page that cannot navigate", () => {
    const { props } = resolveElementProps(mountableConfig(), {
      onNavigate: null,
    });
    expect(props.onNavigate).toBeUndefined();
  });

  it("passes an assigned navigate handler through untouched", () => {
    const navigate = () => undefined;
    const { props } = resolveElementProps(mountableConfig(), {
      onNavigate: navigate,
    });
    expect(props.onNavigate).toBe(navigate);
  });

  it("carries the property bag alongside the attribute config", () => {
    const theme = { primary: "#111111" };
    const suggestions = ["How do refunds work?"];
    const onError = () => undefined;
    const { props } = resolveElementProps(
      { ...mountableConfig(), mode: "auto", hotkey: false },
      { theme, suggestions, onError },
    );
    expect(props.publishableKey).toBe("pk_test_element");
    expect(props.mode).toBe("auto");
    expect(props.hotkey).toBe(false);
    expect(props.theme).toBe(theme);
    expect(props.suggestions).toBe(suggestions);
    expect(props.onError).toBe(onError);
  });

  it("passes a well-formed actions adapter through", () => {
    const adapter = { kind: "cookies", baseUrl: "https://api.host.test" };
    const { props, warnings } = resolveElementProps(mountableConfig(), {
      actionsAdapter: adapter as ElementHostProps["actionsAdapter"],
    });
    expect(props.actionsAdapter).toBe(adapter);
    expect(warnings).toEqual([]);
  });

  it("treats a cleared property as unset rather than crashing on it", () => {
    // Assigning null is how a plain-JS host clears something it set,
    // and there is no compiler to stop it. Underneath, the theme mapper
    // indexes the value, the adapter's kind is dereferenced, and
    // identity is announced by `getEndUserToken !== undefined` — so a
    // null reaching any of them throws or lies.
    const { props, warnings } = resolveElementProps(mountableConfig(), {
      getEndUserToken: null,
      actionsAdapter: null,
      onError: null,
      theme: null,
      suggestions: null,
    });
    expect(props.getEndUserToken).toBeUndefined();
    expect(props.actionsAdapter).toBeUndefined();
    expect(props.onError).toBeUndefined();
    expect(props.theme).toBeUndefined();
    expect(props.suggestions).toBeUndefined();
    // Clearing is deliberate, not a mistake — nothing to complain about.
    expect(warnings).toEqual([]);
  });

  it("passes a well-formed tool-view registry through by reference", () => {
    // By reference is contract, not convenience: the view slot tracks a
    // failed adapter by object identity, so the sanitizer must never
    // clone what it lets through.
    const registration = {
      version: 1,
      view: {
        mount: () => ({ update: () => undefined, destroy: () => undefined }),
      },
      icon: {
        mount: () => ({ update: () => undefined, destroy: () => undefined }),
      },
    };
    const { props, warnings } = resolveElementProps(mountableConfig(), {
      toolViews: {
        "northwind.inventory-check": registration,
      },
    });
    expect(props.toolViews?.["northwind.inventory-check"]).toBe(registration);
    expect(warnings).toEqual([]);
  });

  it("refuses reserved teaflask.* keys at the door, and says which", () => {
    // The resolution ladder refuses reserved keys again, silently — this
    // asserts the DOOR's own refusal: the key is absent from the
    // resolved registry object itself, with a warning naming it.
    const view = {
      mount: () => ({ update: () => undefined, destroy: () => undefined }),
    };
    const { props, warnings } = resolveElementProps(mountableConfig(), {
      toolViews: {
        "teaflask.search": { version: 1, view },
        "northwind.inventory-check": { version: 1, view },
      },
    });
    expect(Object.keys(props.toolViews ?? {})).toEqual([
      "northwind.inventory-check",
    ]);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('toolViews["teaflask.search"]');
    expect(warnings[0]).toContain("reserved");
  });

  it("drops each malformed registration alone; well-formed siblings survive", () => {
    const view = {
      mount: () => ({ update: () => undefined, destroy: () => undefined }),
    };
    const good = { version: 1, view };
    const { props, warnings } = resolveElementProps(mountableConfig(), {
      toolViews: {
        not_an_object: 42,
        null_registration: null,
        string_version: { version: "1", view },
        nan_version: { version: Number.NaN, view },
        infinite_version: { version: Number.POSITIVE_INFINITY, view },
        view_without_mount: { version: 1, view: {} },
        view_mount_not_callable: { version: 1, view: { mount: "mount" } },
        icon_mount_not_callable: { version: 1, icon: { mount: 7 } },
        good_key: good,
      } as unknown as ElementHostProps["toolViews"],
    });
    expect(Object.keys(props.toolViews ?? {})).toEqual(["good_key"]);
    expect(props.toolViews?.good_key).toBe(good);
    expect(warnings).toHaveLength(8);
    for (const dropped of [
      "not_an_object",
      "null_registration",
      "string_version",
      "nan_version",
      "infinite_version",
      "view_without_mount",
      "view_mount_not_callable",
      "icon_mount_not_callable",
    ]) {
      expect(
        warnings.some((warning) => warning.includes(`toolViews["${dropped}"]`)),
      ).toBe(true);
    }
  });

  it("lands hostile key names as inert data, never as prototype surgery", () => {
    // Own keys literally named "__proto__" or "constructor" (reachable
    // via JSON.parse or computed keys) must land as plain data on the
    // sanitized registry — assignment must not mutate its prototype, and
    // the keys must not shadow Object.prototype for later readers.
    const view = {
      mount: () => ({ update: () => undefined, destroy: () => undefined }),
    };
    const hostile = JSON.parse(
      '{"__proto__": {"version": 1}, "constructor": {"version": 1}}',
    ) as Record<string, { version: number }>;
    for (const key of Object.keys(hostile)) {
      (hostile[key] as { view?: unknown }).view = view;
    }
    const { props, warnings } = resolveElementProps(mountableConfig(), {
      toolViews: hostile,
    });
    const sanitized = props.toolViews ?? {};
    expect(Object.getPrototypeOf(sanitized)).toBeNull();
    expect(Object.keys(sanitized).sort()).toEqual(["__proto__", "constructor"]);
    // Computed key on purpose: a literal `.__proto__` access is exactly
    // the trap under test.
    const protoKey = "__proto__";
    expect(sanitized[protoKey]).toMatchObject({ version: 1 });
    expect(warnings).toEqual([]);
  });

  it("treats a null view or icon as a cleared role the ladder reads as absent", () => {
    // The ladder tests roles with `!== undefined`, so a host's null must
    // not travel: it normalizes away, and the surviving adapter keeps
    // its identity.
    const icon = {
      mount: () => ({ update: () => undefined, destroy: () => undefined }),
    };
    const { props, warnings } = resolveElementProps(mountableConfig(), {
      toolViews: {
        cleared_view: { version: 1, view: null, icon },
        role_less: { version: 2 },
      } as unknown as ElementHostProps["toolViews"],
    });
    const clearedView = props.toolViews?.cleared_view;
    expect(clearedView?.view).toBeUndefined();
    expect("view" in (clearedView ?? {})).toBe(false);
    expect(clearedView?.icon).toBe(icon);
    // A registration with no role at all passes through — the ladder
    // treats it exactly like an absent registration (React-path parity).
    expect(props.toolViews?.role_less).toMatchObject({ version: 2 });
    expect(warnings).toEqual([]);
  });

  it("keeps a non-integer finite version — rung 2 never compares it", () => {
    const view = {
      mount: () => ({ update: () => undefined, destroy: () => undefined }),
    };
    const registration = { version: 1.5, view };
    const { props, warnings } = resolveElementProps(mountableConfig(), {
      toolViews: {
        fractional: registration,
      },
    });
    expect(props.toolViews?.fractional).toBe(registration);
    expect(warnings).toEqual([]);
  });

  it("treats a cleared or non-object toolViews as unset, warning only on garbage", () => {
    const cleared = resolveElementProps(mountableConfig(), { toolViews: null });
    expect(cleared.props.toolViews).toBeUndefined();
    expect(cleared.warnings).toEqual([]);

    const garbage = resolveElementProps(mountableConfig(), {
      toolViews: "nope" as unknown as ElementHostProps["toolViews"],
    });
    expect(garbage.props.toolViews).toBeUndefined();
    expect(garbage.warnings).toHaveLength(1);
    expect(garbage.warnings[0]).toContain("toolViews");

    const arrayish = resolveElementProps(mountableConfig(), {
      toolViews: [] as unknown as ElementHostProps["toolViews"],
    });
    expect(arrayish.props.toolViews).toBeUndefined();
    expect(arrayish.warnings).toHaveLength(1);
    expect(arrayish.warnings[0]).toContain("an array");
  });

  it("refuses an adapter whose kind is mistyped, and says which", () => {
    // The executor reads `kind` positively three times, so "cookie"
    // wouldn't throw — it would fetch with credentials silently
    // dropped, surfacing as unexplained 401s from the host's own API.
    // No adapter at all is the honest, in-band state instead.
    const { props, warnings } = resolveElementProps(mountableConfig(), {
      actionsAdapter: {
        kind: "cookie",
        baseUrl: "https://api.host.test",
      } as unknown as ElementHostProps["actionsAdapter"],
    });
    expect(props.actionsAdapter).toBeUndefined();
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('"cookie"');
    expect(warnings[0]).toContain("cannot perform");
  });
});

describe("parsePageElementConfig", () => {
  it("observes no widget-only knobs and no global HTML attributes", () => {
    // No companion, palette, or hotkey — observing their attributes
    // would imply an API the element does not have. And the surface's
    // display name rides `heading`, never `title`: the global HTML
    // `title` attribute would render a native tooltip over the whole
    // surface and name the region for screen readers.
    expect(OBSERVED_PAGE_ELEMENT_ATTRIBUTES).toEqual([
      "publishable-key",
      "base-url",
      "mode",
      "heading",
      "frameless",
    ]);
    expect(OBSERVED_PAGE_ELEMENT_ATTRIBUTES).not.toContain("title");
  });

  it("maps the kebab attributes onto their props", () => {
    const config = parsePageElementConfig(
      attributesOf({
        "publishable-key": "pk_test_page",
        "base-url": "http://localhost:8000",
        mode: "dark",
        heading: "Acme Help",
        frameless: "true",
      }),
    );
    expect(config).toEqual({
      publishableKey: "pk_test_page",
      baseUrl: "http://localhost:8000",
      mode: "dark",
      heading: "Acme Help",
      frameless: true,
      warnings: [],
    });
  });

  it("reads the frameless truth table: bare and true are on, false is off", () => {
    expect(
      parsePageElementConfig(attributesOf({ frameless: "" })).frameless,
    ).toBe(true);
    expect(
      parsePageElementConfig(attributesOf({ frameless: "true" })).frameless,
    ).toBe(true);
    expect(
      parsePageElementConfig(attributesOf({ frameless: "false" })).frameless,
    ).toBe(false);
    expect(parsePageElementConfig(attributesOf({})).frameless).toBeUndefined();
  });

  it("warns and degrades an unrecognized frameless value", () => {
    const config = parsePageElementConfig(attributesOf({ frameless: "ture" }));
    expect(config.frameless).toBeUndefined();
    expect(config.warnings).toHaveLength(1);
    expect(config.warnings[0]).toContain('frameless "ture"');
  });
});

describe("resolvePageElementProps", () => {
  it("splits the config between the provider and the page", () => {
    const suggestions = ["How do refunds work?"];
    const theme = { primary: "#111111" };
    const { providerProps, pageProps, warnings } = resolvePageElementProps(
      {
        ...mountablePageConfig(),
        baseUrl: "http://localhost:8000",
        mode: "auto",
        heading: "Acme Help",
        frameless: true,
      },
      { theme, suggestions },
    );
    expect(providerProps.publishableKey).toBe("pk_test_page");
    expect(providerProps.baseUrl).toBe("http://localhost:8000");
    expect(providerProps.mode).toBe("auto");
    expect(providerProps.theme).toBe(theme);
    expect(pageProps.title).toBe("Acme Help");
    expect(pageProps.frameless).toBe(true);
    expect(pageProps.suggestions).toBe(suggestions);
    expect(warnings).toEqual([]);
  });

  it("keeps the widget's navigation tri-state and null-clearing rules", () => {
    const unset = resolvePageElementProps(mountablePageConfig(), {});
    expect(unset.providerProps.onNavigate).toBe(navigateByFullPageLoad);

    const cleared = resolvePageElementProps(mountablePageConfig(), {
      onNavigate: null,
      getEndUserToken: null,
      actionsAdapter: null,
      onError: null,
      theme: null,
      suggestions: null,
    });
    expect(cleared.providerProps.onNavigate).toBeUndefined();
    expect(cleared.providerProps.getEndUserToken).toBeUndefined();
    expect(cleared.providerProps.actionsAdapter).toBeUndefined();
    expect(cleared.providerProps.onError).toBeUndefined();
    expect(cleared.providerProps.theme).toBeUndefined();
    expect(cleared.pageProps.suggestions).toBeUndefined();
    expect(cleared.warnings).toEqual([]);
  });

  it("refuses a mistyped actions adapter exactly like the widget", () => {
    const { providerProps, warnings } = resolvePageElementProps(
      mountablePageConfig(),
      {
        actionsAdapter: {
          kind: "cookie",
          baseUrl: "https://api.host.test",
        } as unknown as ElementHostProps["actionsAdapter"],
      },
    );
    expect(providerProps.actionsAdapter).toBeUndefined();
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('"cookie"');
  });

  it("sanitizes toolViews exactly like the widget", () => {
    const view = {
      mount: () => ({ update: () => undefined, destroy: () => undefined }),
    };
    const good = { version: 1, view };
    const { providerProps, warnings } = resolvePageElementProps(
      mountablePageConfig(),
      {
        toolViews: {
          "teaflask.search": { version: 1, view },
          broken: { version: 1, view: {} },
          "northwind.inventory-check": good,
        } as unknown as ElementHostProps["toolViews"],
      },
    );
    expect(Object.keys(providerProps.toolViews ?? {})).toEqual([
      "northwind.inventory-check",
    ]);
    expect(providerProps.toolViews?.["northwind.inventory-check"]).toBe(good);
    expect(warnings).toHaveLength(2);
    expect(warnings[0]).toContain('toolViews["teaflask.search"]');
    expect(warnings[1]).toContain('toolViews["broken"]');
  });
});
