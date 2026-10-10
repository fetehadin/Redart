import type { Theme } from "@redart/shared";

export const THEME_KEY = "redart:theme";

/**
 * Runs inline before first paint so the page never flashes the wrong theme.
 * Falls back to the theme saved inside a v2 ledger from before themes had their own key.
 */
export const THEME_BOOT_SCRIPT = `try{var t=localStorage.getItem("${THEME_KEY}");if(!t){var l=JSON.parse(localStorage.getItem("redart:v2")||"null");t=l&&l.prefs&&l.prefs.theme}if(t==="light"||t==="dark")document.documentElement.setAttribute("data-theme",t)}catch(e){}`;

export function readTheme(): Theme {
  const attr = document.documentElement.getAttribute("data-theme");
  return attr === "light" || attr === "dark" ? attr : "system";
}

export function applyTheme(t: Theme) {
  if (t === "system") document.documentElement.removeAttribute("data-theme");
  else document.documentElement.setAttribute("data-theme", t);
  try { localStorage.setItem(THEME_KEY, t); } catch { /* theme just won't persist */ }
}
