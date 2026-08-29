import { adoptComponentRoot, connectComponentHmr, defineComponent, hydrate, registerComponentSource, type Component } from "./index.js";

declare global {
  interface Window {
    ThymeleafReactive?: {
      handlers: Record<string, (...args: any[]) => any>;
      hydrate: typeof hydrate;
    };
  }
}

function parseState(value: string | undefined): object {
  if (!value) return {};
  try { return JSON.parse(value) as object; }
  catch (error) {
    console.error("[thymeleaf-reactive] invalid data-tr-state JSON", error);
    return {};
  }
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
  Object.assign(state, handlers);
  adoptComponentRoot(
    root,
    defineComponent(name, component as Component),
    state as Record<string, unknown>
  );
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
