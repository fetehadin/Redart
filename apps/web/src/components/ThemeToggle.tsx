"use client";
import { useSyncExternalStore } from "react";
import type { Theme } from "@redart/shared";
import { applyTheme, readTheme } from "@/lib/theme";

const ORDER: Theme[] = ["system", "light", "dark"];
const LABEL: Record<Theme, string> = { system: "Auto", light: "Light", dark: "Dark" };

function subscribe(cb: () => void) {
  const obs = new MutationObserver(cb);
  obs.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  return () => obs.disconnect();
}

export function ThemeToggle() {
  // null on the server: the saved theme is only known in the browser.
  const theme = useSyncExternalStore<Theme | null>(subscribe, readTheme, () => null);
  const t = theme ?? "system";
  const title = `Theme: ${t === "system" ? "match device" : t}. Click to change.`;
  return (
    <button
      className="btn icon-btn"
      type="button"
      title={title}
      aria-label={title}
      onClick={() => applyTheme(ORDER[(ORDER.indexOf(t) + 1) % ORDER.length]!)}
    >
      {theme ? LABEL[t] : "Theme"}
    </button>
  );
}
