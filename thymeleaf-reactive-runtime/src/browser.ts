import { connectComponentHmr, hydrate } from "./index.js";

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

function boot(): void {
  const api = window.ThymeleafReactive ?? { handlers: {}, hydrate };
  window.ThymeleafReactive = api;
  document.querySelectorAll<HTMLElement>("[data-tr-component]").forEach(root => {
    if (root.dataset.trHydrated === "true") return;
    api.hydrate(root, parseState(root.dataset.trState), api.handlers);
    root.dataset.trHydrated = "true";
  });
  connectComponentHmr();
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot, { once: true });
else boot();
