import { adoptComponentRoot, connectComponentHmr, defineComponent, hydrate, hydrateOnIdle, hydrateOnInteraction, hydrateOnMediaQuery, hydrateOnVisible, registerComponentSource, type Component, type HydrationStrategy } from "./index.js";

declare global {
  interface Window {
    ThymeleafReactive?: {
      handlers: Record<string, (...args: any[]) => any>;
      hydrate: typeof hydrate;
    };
  }
}

function parseJson(value: string | undefined, attribute: string): Record<string, unknown> {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
  }
  catch (error) {
    console.error(`[thymeleaf-reactive] invalid ${attribute} JSON`, error);
    return {};
  }
}

export function parseState(value: string | undefined): Record<string, unknown> {
  return parseJson(value, "data-tr-state");
}

export function parseProps(value: string | undefined): Record<string, unknown> {
  return parseJson(value, "data-tr-props");
}

/** Adapts Thymeleaf handlers, whose first argument is state, for SFC template calls. */
export function bindSfcHandlers(state: object, handlers: Record<string, (...args: any[]) => any>): Record<string, (...args: any[]) => any> {
  return Object.fromEntries(Object.entries(handlers).map(([name, handler]) => [name,
    (...args: any[]) => handler(state, ...args)
  ]));
}

async function adoptSfcComponent(
  root: HTMLElement,
  state: object,
  handlers: Record<string, (...args: any[]) => any>
): Promise<void> {
  const source = root.dataset.trComponentSrc;
  const name = root.dataset.trComponent;
  if (!source || !name) return;
  const moduleUrl = new URL("/__thymeleaf_reactive__/component", window.location.origin);
  moduleUrl.searchParams.set("path", source);
  const module = await import(moduleUrl.href);
  const component = module.default ?? module.render;
  if ((typeof component !== "function") && (typeof component !== "object" || component === null)) {
    throw new Error(`SFC ${source} has no component export`);
  }
  registerComponentSource(source, name);
  Object.assign(state, parseProps(root.dataset.trProps), bindSfcHandlers(state, handlers));
  adoptComponentRoot(
    root,
    defineComponent(name, component as Component),
    state as Record<string, unknown>
  );
}

/** Parses data-tr-hydrate values into lazy hydration strategies. */
function hydrateStrategyFor(value: string, root: HTMLElement): (hydrate: () => void) => HydrationStrategy {
  const onRoot = (callback: (element: Element) => void) => callback(root);
  const [kind, argument] = value.split(":").map(part => part.trim());
  switch (kind) {
    case "visible": return hydrate => hydrateOnVisible(hydrate, onRoot, argument ? { rootMargin: argument } : {});
    case "interaction": return hydrate => hydrateOnInteraction(hydrate, argument ? argument.split(",").map(event => event.trim()).filter(Boolean) : ["click"], onRoot);
    case "media": return hydrate => hydrateOnMediaQuery(hydrate, argument ?? "");
    case "idle": default: return hydrate => hydrateOnIdle(hydrate, argument ? { timeout: Number(argument) || 200 } : {});
  }
}

async function boot(): Promise<void> {
  const api = {
    handlers: window.ThymeleafReactive?.handlers ?? {},
    hydrate: window.ThymeleafReactive?.hydrate ?? hydrate
  };
  window.ThymeleafReactive = api;
  const roots = Array.from(document.querySelectorAll<HTMLElement>("[data-tr-component]"));
  const states = new Map<HTMLElement, object>();
  roots.forEach(root => {
    if (root.dataset.trHydrated === "true") return;
    const state = parseState(root.dataset.trState);
    // data-tr-hydrate defers the whole hydration + SFC adoption of this root
    // until the requested strategy fires (islands-style lazy hydration). The
    // strategy request goes through the queued hydration entry, so fires are
    // coalesced to one hydration job per root per flush.
    const hydrateAttr = root.dataset.trHydrate;
    if (hydrateAttr) {
      states.set(root, state);
      root.dataset.trHydrated = "pending";
      api.hydrate(root, state, api.handlers, {
        hydrateOn: request => hydrateStrategyFor(hydrateAttr, root)(() => {
          api.hydrate(root, state, api.handlers);
          root.dataset.trHydrated = "true";
          void adoptSfcComponent(root, state, api.handlers).catch(error =>
            console.error("[thymeleaf-reactive] failed to load SFC component", error)
          );
        })
      });
      return;
    }
    // Metadata hydration provides an interactive server-rendered fallback
    // while an optional resource SFC loads, and remains active if it fails.
    states.set(root, api.hydrate(root, state, api.handlers));
    root.dataset.trHydrated = "true";
  });
  await Promise.all(roots.map(root => adoptSfcComponent(root, states.get(root) ?? {}, api.handlers).catch(error =>
    console.error("[thymeleaf-reactive] failed to load SFC component", error)
  )));
  connectComponentHmr();
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot, { once: true });
else boot();
