// Redart front end. Plain ES modules, no build step.
import {
  LIMITS, parseISO, addDays, diffDays, todayISO, planEnd, uid, clampInt, safeUrl, urlKey, articleKey,
  spread, nextDueDate, scheduleStatus, planStats, sanitizeLink, linkIsStale, newArticle, articlesFromRows,
  sanitizeState, favoriteFromArticle, SCHEMA_VERSION,
} from "./core.js";
import { STARTER } from "./starter.js";

const KEY = "redart:v2";
const API = "/api/inspect";

/* ================= storage ================= */
let canStore = true;
function readStore(key) { try { return localStorage.getItem(key); } catch { canStore = false; return null; } }
function load() {
  const t = todayISO();
  const raw = readStore(KEY);
  if (raw) { try { const s = sanitizeState(JSON.parse(raw), t); if (s) return s; } catch { /* corrupted: start fresh, keep the bad copy */ backupCorrupt(raw); } }
  try { localStorage.setItem(KEY + ":probe", "1"); localStorage.removeItem(KEY + ":probe"); } catch { canStore = false; }
  return freshState(t);
}
function backupCorrupt(raw) { try { localStorage.setItem(KEY + ":corrupt-" + Date.now(), raw); } catch { /* ignore */ } }
function freshState(t) {
  const articles = articlesFromRows(STARTER, t, 30).map((a) => ({ ...a, minutesAuto: true }));
  const p = { id: uid(), name: "Backend & AI reading — 30 days", start: t, days: 30, articles };
  return { version: SCHEMA_VERSION, active: p.id, plans: [p], favorites: [], prefs: { theme: "system" } };
}
let saveTimer = null;
function save() {
  clearTimeout(saveTimer); saveTimer = null;
  if (!canStore) return;
  try { localStorage.setItem(KEY, JSON.stringify(state)); }
  catch (e) {
    // Quota full is the usual cause; tell the reader instead of failing silently.
    if (e && e.name === "QuotaExceededError") toast("Storage is full. Copy a backup, then delete old plans to free space.");
    else { canStore = false; renderBanners(); }
  }
}
const saveSoon = () => { clearTimeout(saveTimer); saveTimer = setTimeout(save, 400); };
window.addEventListener("pagehide", () => { if (saveTimer) save(); });

let state = load();
let filter = "all";
let query = "";
let pendingDelete = null; // article id waiting for confirmation
let editingId = null;     // article id being edited
const plan = () => state.plans.find((p) => p.id === state.active) || state.plans[0];
const today = () => todayISO();

/* ================= DOM helpers ================= */
const $ = (id) => document.getElementById(id);
function el(tag, attrs, ...kids) {
  const e = document.createElement(tag);
  if (attrs) for (const k in attrs) {
    const v = attrs[k];
    if (v == null || v === false) continue;
    if (k === "class") e.className = v;
    else if (k === "text") e.textContent = v;
    else if (k.startsWith("on")) e.addEventListener(k.slice(2), v);
    else e.setAttribute(k, v === true ? "" : v);
  }
  for (const c of kids) if (c != null && c !== false) e.append(c.nodeType ? c : document.createTextNode(c));
  return e;
}
const fmt = (s, withYear) => { const d = parseISO(s); return d ? d.toLocaleDateString(undefined, withYear ? { month: "short", day: "numeric", year: "numeric" } : { month: "short", day: "numeric" }) : "—"; };
const plural = (n, w) => `${n} ${w}${n === 1 ? "" : "s"}`;
const short = (s, n = 42) => (s.length > n ? s.slice(0, n - 1) + "…" : s);

/** Re-render without losing the reader's place in a text box. */
function preservingFocus(fn) {
  const a = document.activeElement;
  const id = a && a.id;
  let sel = null;
  try { if (a && "selectionStart" in a && a.selectionStart != null) sel = [a.selectionStart, a.selectionEnd]; } catch { /* date inputs */ }
  fn();
  if (id && document.activeElement?.id !== id) {
    const n = document.getElementById(id);
    if (n) { n.focus({ preventScroll: true }); if (sel) try { n.setSelectionRange(sel[0], sel[1]); } catch { /* ignore */ } }
  }
}

/* ================= link inspection ================= */
let apiState = "unknown"; // unknown | yes | no
const inspectCache = new Map(); // urlKey -> Promise<result>

async function callInspect(url) {
  if (!navigator.onLine) return { status: "offline", message: "You're offline. The link will be checked when you reconnect." };
  if (apiState === "no") return { status: "unavailable", message: "Link checks aren't available on this copy of Redart." };
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 20000);
  try {
    const res = await fetch(`${API}?url=${encodeURIComponent(url)}`, { signal: ctrl.signal, headers: { accept: "application/json" } });
    const type = res.headers.get("content-type") || "";
    if (res.status === 404 || !type.includes("json")) { apiState = "no"; return { status: "unavailable", message: "Link checks aren't available on this copy of Redart." }; }
    apiState = "yes";
    const data = await res.json();
    if (res.status === 429 || data.status === "rate_limited") return { status: "rate_limited", message: data.message || "Too many checks. Try again in a minute." };
    return data;
  } catch {
    return { status: "network", message: "Couldn't reach the link checker. Check your connection and try again." };
  } finally { clearTimeout(timer); }
}
/** Results that describe the link (not our own connection) are cached for the session. */
const isFinal = (r) => ["ok", "broken", "restricted", "unreachable", "invalid", "blocked"].includes(r.status);
function inspectUrl(url, force = false) {
  const k = urlKey(url);
  if (!k) return Promise.resolve({ status: "invalid", message: "That doesn't look like a web address." });
  if (!force && inspectCache.has(k)) return inspectCache.get(k);
  const p = callInspect(url).then((r) => { if (!isFinal(r)) inspectCache.delete(k); return r; });
  inspectCache.set(k, p);
  return p;
}

/* background queue for ledger rows */
const checking = new Set();
const queue = [];
let running = 0;
const CONCURRENCY = 2;
function queueCheck(planId, articleId, force = false) {
  if (checking.has(articleId) || queue.some((q) => q.articleId === articleId)) return;
  queue.push({ planId, articleId, force });
  pump();
}
function pump() {
  while (running < CONCURRENCY && queue.length) {
    const job = queue.shift();
    const p = state.plans.find((x) => x.id === job.planId);
    const a = p && p.articles.find((x) => x.id === job.articleId);
    if (!a || !a.url) continue;
    running++;
    checking.add(a.id);
    const urlAtStart = a.url;
    rerenderRows();
    inspectUrl(a.url, job.force).then((r) => {
      running--;
      checking.delete(job.articleId);
      // The article may have been removed or its link edited while we waited.
      const pp = state.plans.find((x) => x.id === job.planId);
      const aa = pp && pp.articles.find((x) => x.id === job.articleId);
      if (aa && aa.url === urlAtStart) applyLinkResult(aa, r);
      rerenderRows();
      pump();
    });
  }
}
function applyLinkResult(a, r) {
  const link = sanitizeLink(r);
  if (!link) return; // offline / unavailable / rate limited: keep the old result
  a.link = link;
  if (r.status === "ok" && Number.isInteger(r.minutes) && a.minutesAuto) a.minutes = clampInt(r.minutes, 1, 600, a.minutes);
  saveSoon();
}
function autoCheck() {
  if (!navigator.onLine || apiState === "no") return;
  const now = Date.now();
  const p = plan();
  p.articles.filter((a) => linkIsStale(a, now)).forEach((a) => queueCheck(p.id, a.id));
}

function linkBadge(a) {
  if (!a.url) return el("span", { class: "link muted", text: "No link" });
  if (checking.has(a.id)) return el("span", { class: "link muted" }, el("span", { class: "spin", "aria-hidden": "true" }), "Checking link…");
  const l = a.link;
  if (!l) return el("span", { class: "link muted", text: "Link not checked" });
  const when = "checked " + new Date(l.checkedAt).toLocaleDateString(undefined, { month: "short", day: "numeric" });
  switch (l.status) {
    case "ok": return el("span", { class: "link ok", title: when, text: "✓ Link works" });
    case "restricted": return el("span", { class: "link warn", title: l.message + " (" + when + ")", text: "? Site blocked the check" });
    case "timeout": case "unreachable": return el("span", { class: "link warn", title: l.message + " (" + when + ")", text: "! Site not responding" });
    default: return el("span", { class: "link bad", title: l.message + " (" + when + ")", text: "✕ Broken link" });
  }
}

/* ================= favourites ================= */
const favIndex = () => new Map(state.favorites.map((f) => [articleKey(f), f]));
function isFav(a, idx = favIndex()) { return idx.has(articleKey(a)); }
function toggleFav(a) {
  const k = articleKey(a);
  const i = state.favorites.findIndex((f) => articleKey(f) === k);
  if (i >= 0) {
    const [gone] = state.favorites.splice(i, 1);
    commit();
    toast("Removed from favourites", () => { state.favorites.splice(Math.min(i, state.favorites.length), 0, gone); commit(); });
  } else {
    state.favorites.unshift(favoriteFromArticle(a, today()));
    commit();
    toast("Saved to favourites. Find it under ★ Favourites, in any plan.");
  }
}

/* ================= render ================= */
function renderBanners() {
  $("storageBanner").hidden = canStore;
  $("offlineBanner").hidden = navigator.onLine;
}
function renderTheme() {
  const t = state.prefs.theme;
  if (t === "system") document.documentElement.removeAttribute("data-theme");
  else document.documentElement.setAttribute("data-theme", t);
  const b = $("themeBtn");
  b.textContent = t === "dark" ? "Dark" : t === "light" ? "Light" : "Auto";
  b.title = `Theme: ${t === "system" ? "match device" : t}. Click to change.`;
  b.setAttribute("aria-label", b.title);
}
function renderPlans() {
  const sel = $("planSel"); sel.textContent = "";
  [...state.plans].sort((a, b) => b.start.localeCompare(a.start)).forEach((p) =>
    sel.append(el("option", { value: p.id, text: `${p.name}  (${fmt(p.start)} – ${fmt(planEnd(p))})` })));
  sel.value = state.active;
}
function renderSummary() {
  const p = plan(), s = $("summary"), t = today(), st = planStats(p, t);
  s.textContent = "";
  let dayLabel, daySub;
  if (st.phase === "before") { dayLabel = "Starts " + fmt(p.start); daySub = "in " + plural(1 - st.dayNo, "day"); }
  else if (st.phase === "after") { dayLabel = "Finished"; daySub = "ended " + fmt(st.end, true); }
  else { dayLabel = `Day ${st.dayNo} of ${p.days}`; daySub = `${plural(p.days - st.dayNo, "day")} left · ends ${fmt(st.end)}`; }
  const stat = (k, v, sub, cls) => el("div", { class: "stat" }, el("div", { class: "k", text: k }), el("div", { class: "v" + (cls ? " " + cls : ""), text: v }), sub ? el("div", { class: "s", text: sub }) : null);
  s.append(
    stat("Articles read", `${st.done} / ${st.total}`, st.total ? Math.round((st.done * 100) / st.total) + "% complete" : "nothing on the list yet"),
    stat("Reading time", `${st.minutesDone} / ${st.minutesAll} min`, `${st.minutesAll - st.minutesDone} min still to read`),
    stat("Timeline", dayLabel, daySub),
    stat("Pace", st.pace.text, st.next ? `Next: ${short(st.next.title, 60)} (${fmt(st.next.due)})` : null, "small " + (st.pace.key === "behind" ? "behind" : st.pace.key === "ok" ? "ok" : "")),
  );
  const bar = el("div", { class: "bar", role: "progressbar", "aria-label": "Articles read", "aria-valuemin": "0", "aria-valuemax": String(st.total || 1), "aria-valuenow": String(st.done) });
  const fill = el("i"); fill.style.width = (st.total ? (st.done * 100) / st.total : 0) + "%"; bar.append(fill);
  if (st.total && st.expected > 0 && st.done < st.total) {
    const m = el("b", { title: "Where you should be today" });
    m.style.left = `calc(${(Math.min(st.expected, st.total) * 100) / st.total}% - 1px)`;
    bar.append(m);
  }
  s.append(bar);
}

function matches(item) {
  if (!query) return true;
  const q = query.toLowerCase();
  return item.title.toLowerCase().includes(q) || (item.topic || "").toLowerCase().includes(q) || (item.url || "").toLowerCase().includes(q);
}

function renderLedger() {
  const L = $("ledger"); L.textContent = "";
  if (filter === "fav") return renderFavorites(L);
  const p = plan(), t = today(), idx = favIndex();
  if (!p.articles.length) {
    L.append(el("div", { class: "empty" }, el("h3", { text: "This ledger is empty" }),
      el("p", { text: "Paste an article link in “Add an article” below. Redart checks the link and estimates the read time for you." }),
      el("button", { class: "btn", type: "button", text: "Add an article", onclick: () => { $("addPanel").open = true; $("aUrl").focus(); } })));
    return;
  }
  const rows = p.articles.map((a, i) => ({ a, i })).filter(({ a }) => (filter === "all" || (filter === "done" ? a.done : !a.done)) && matches(a));
  if (!rows.length) {
    const msg = query ? ["No matches", `Nothing in this plan matches “${query}”.`]
      : filter === "done" ? ["Nothing read yet", "Tick an article when you finish it and it shows up here."]
      : ["Everything is read", "Every article in this plan is ticked off. Start a new plan when you're ready."];
    L.append(el("div", { class: "empty" }, el("h3", { text: msg[0] }), el("p", { text: msg[1] })));
    return;
  }
  for (const { a, i } of rows) L.append(editingId === a.id ? editRow(a, i) : articleRow(a, i, p, t, idx));
}

function articleRow(a, i, p, t, idx) {
  const sch = scheduleStatus(a, t);
  const titleNode = a.url ? el("a", { href: a.url, target: "_blank", rel: "noopener noreferrer", text: a.title }) : el("span", { class: "t", text: a.title });
  const cb = el("input", { type: "checkbox", id: "cb-" + a.id, "aria-label": `Mark “${a.title}” as read`, onchange: (e) => toggleDone(a.id, e.target.checked) });
  cb.checked = a.done;
  const fav = isFav(a, idx);
  const star = el("button", { class: "star", type: "button", id: "star-" + a.id, "aria-pressed": String(fav), "aria-label": fav ? "Remove from favourites" : "Save to favourites", title: fav ? "Remove from favourites" : "Save to favourites", text: fav ? "★" : "☆", onclick: () => toggleFav(a) });
  const due = el("input", { type: "date", id: "due-" + a.id, value: a.due, "aria-label": "Due date", onchange: (e) => { if (parseISO(e.target.value)) { a.due = e.target.value; commit(); } else e.target.value = a.due; } });
  const notes = el("textarea", { id: "note-" + a.id, placeholder: "Your note: what you learned, and one thing to apply…", "aria-label": "Notes for " + a.title, maxlength: String(LIMITS.notes) });
  notes.value = a.notes;
  notes.addEventListener("input", () => { a.notes = notes.value; saveSoon(); });
  notes.addEventListener("blur", save);

  const linkMsg = a.link && a.link.status !== "ok" && !checking.has(a.id)
    ? el("span", { class: "link-msg" + (["restricted", "timeout", "unreachable"].includes(a.link.status) ? " warn" : ""), text: a.link.message }) : null;

  let actions;
  if (pendingDelete === a.id) {
    actions = el("div", { class: "actions" }, el("span", { class: "confirm" }, "Remove?",
      el("button", { class: "icon danger", type: "button", id: "del-yes-" + a.id, text: "Yes, remove", onclick: () => removeArticle(a.id) }),
      el("button", { class: "icon", type: "button", text: "Keep", onclick: () => { pendingDelete = null; renderLedger(); } })));
  } else {
    actions = el("div", { class: "actions" },
      el("button", { class: "icon", type: "button", text: "Edit", "aria-label": "Edit " + a.title, onclick: () => { editingId = a.id; pendingDelete = null; renderLedger(); $("e-title-" + a.id)?.focus(); } }),
      a.url ? el("button", { class: "icon", type: "button", text: "Recheck", title: "Check the link again", disabled: checking.has(a.id), onclick: () => queueCheck(p.id, a.id, true) }) : null,
      el("button", { class: "icon", type: "button", text: "▲", title: "Move up", "aria-label": "Move up", disabled: i === 0 || !!query, onclick: () => move(i, -1) }),
      el("button", { class: "icon", type: "button", text: "▼", title: "Move down", "aria-label": "Move down", disabled: i === p.articles.length - 1 || !!query, onclick: () => move(i, 1) }),
      el("button", { class: "icon", type: "button", text: "Remove", "aria-label": "Remove " + a.title, onclick: () => { pendingDelete = a.id; renderLedger(); $("del-yes-" + a.id)?.focus(); } }));
  }
  return el("div", { class: "row" + (a.done ? " done" : ""), "data-id": a.id },
    el("div", { class: "num", text: String(i + 1).padStart(2, "0") }),
    el("div", { class: "main" },
      el("div", { class: "ttl" }, cb, titleNode, star),
      el("div", { class: "meta" },
        el("span", { class: "status " + sch.key, text: sch.label }),
        a.topic ? el("span", { class: "chip", text: a.topic }) : null,
        el("span", { class: "mono", title: a.minutesAuto ? "Estimated from the article's length" : "Set by you", text: `${a.minutes} min read${a.minutesAuto ? " (est.)" : ""}` }),
        linkBadge(a),
        el("label", { class: "mono", for: "due-" + a.id, text: "due" }), due,
        a.done && a.doneAt ? el("span", { class: "mono", text: "read " + fmt(a.doneAt) }) : null,
        linkMsg),
      el("div", { class: "notes" }, notes)),
    actions);
}

function editRow(a, i) {
  const f = (id, label, input, wide) => el("div", { class: "field" + (wide ? " wide" : "") }, el("label", { class: "lbl", for: id, text: label }), input);
  const title = el("input", { type: "text", id: "e-title-" + a.id, maxlength: String(LIMITS.title), value: a.title });
  const url = el("input", { type: "url", id: "e-url-" + a.id, value: a.url, placeholder: "https://…" });
  const topic = el("input", { type: "text", id: "e-topic-" + a.id, maxlength: String(LIMITS.topic), value: a.topic, list: "topicList" });
  const mins = el("input", { type: "number", id: "e-min-" + a.id, min: "1", max: "600", value: String(a.minutes), inputmode: "numeric" });
  const err = el("span", { class: "err", role: "alert" });
  const saveEdit = () => {
    const t = title.value.trim();
    if (!t) { err.textContent = "The title can't be empty."; title.focus(); return; }
    let u = "";
    if (url.value.trim()) { u = safeUrl(url.value); if (!u) { err.textContent = "That link doesn't look right. Use a full address like https://example.com/post."; url.focus(); return; } }
    const k = urlKey(u);
    if (k && plan().articles.some((x) => x.id !== a.id && urlKey(x.url) === k)) { err.textContent = "Another article in this plan already uses this link."; url.focus(); return; }
    const m = Number(mins.value);
    if (!Number.isFinite(m) || m < 1 || m > 600) { err.textContent = "Read time must be between 1 and 600 minutes."; mins.focus(); return; }
    const oldKey = articleKey(a);
    const fav = state.favorites.find((x) => articleKey(x) === oldKey);
    const linkChanged = u !== a.url;
    const minutesChanged = Math.round(m) !== a.minutes;
    a.title = t.slice(0, LIMITS.title); a.url = u; a.topic = topic.value.trim().slice(0, LIMITS.topic);
    if (minutesChanged) { a.minutes = Math.round(m); a.minutesAuto = false; }
    if (linkChanged) { a.link = null; if (!minutesChanged) a.minutesAuto = true; }
    if (fav) Object.assign(fav, { title: a.title, url: a.url, topic: a.topic, minutes: a.minutes });
    editingId = null; commit();
    if (linkChanged && a.url) queueCheck(plan().id, a.id, true);
    $("cb-" + a.id)?.focus();
  };
  const onKey = (e) => { if (e.key === "Enter" && e.target.tagName === "INPUT") { e.preventDefault(); saveEdit(); } if (e.key === "Escape") { editingId = null; renderLedger(); } };
  return el("div", { class: "row", "data-id": a.id, onkeydown: onKey },
    el("div", { class: "num", text: String(i + 1).padStart(2, "0") }),
    el("div", { class: "main" },
      el("div", { class: "edit" },
        f(title.id, "Title", title, true), f(url.id, "Link", url, true), f(topic.id, "Topic", topic), f(mins.id, "Read time (min)", mins),
        el("div", { class: "wide confirm" },
          el("button", { class: "btn solid", type: "button", text: "Save", onclick: saveEdit }),
          el("button", { class: "btn", type: "button", text: "Cancel", onclick: () => { editingId = null; renderLedger(); } }), err))),
    el("div"));
}

function renderFavorites(L) {
  const p = plan();
  const inPlan = new Set(p.articles.map(articleKey));
  const favs = state.favorites.filter(matches);
  if (!state.favorites.length) {
    L.append(el("div", { class: "empty" }, el("h3", { text: "No favourites yet" }),
      el("p", { text: "Tap the ☆ next to any article to keep it here. Favourites stay with you across every plan, even after you delete one." })));
    return;
  }
  if (!favs.length) { L.append(el("div", { class: "empty" }, el("h3", { text: "No matches" }), el("p", { text: `No favourite matches “${query}”.` }))); return; }
  favs.forEach((f, i) => {
    const titleNode = f.url ? el("a", { href: f.url, target: "_blank", rel: "noopener noreferrer", text: f.title }) : el("span", { class: "t", text: f.title });
    const has = inPlan.has(articleKey(f));
    L.append(el("div", { class: "row" },
      el("div", { class: "num", text: String(i + 1).padStart(2, "0") }),
      el("div", { class: "main" },
        el("div", { class: "ttl" }, titleNode,
          el("button", { class: "star", type: "button", "aria-pressed": "true", "aria-label": "Remove from favourites", title: "Remove from favourites", text: "★", onclick: () => toggleFav(f) })),
        el("div", { class: "meta" },
          f.topic ? el("span", { class: "chip", text: f.topic }) : null,
          el("span", { class: "mono", text: f.minutes + " min read" }),
          el("span", { class: "mono", text: "saved " + fmt(f.savedAt, true) }))),
      el("div", { class: "actions" },
        has ? el("span", { class: "icon", text: "In this plan" })
          : el("button", { class: "icon", type: "button", text: "Add to this plan", onclick: () => addFavToPlan(f) }))));
  });
}

function renderTopics() {
  const set = new Set();
  state.plans.forEach((p) => p.articles.forEach((a) => a.topic && set.add(a.topic)));
  state.favorites.forEach((f) => f.topic && set.add(f.topic));
  const dl = $("topicList"); dl.textContent = "";
  [...set].sort((a, b) => a.localeCompare(b)).forEach((t) => dl.append(el("option", { value: t })));
}
function renderPlanForm() {
  const p = plan();
  $("pName").value = p.name; $("pStart").value = p.start; $("pDays").value = p.days; $("pErr").textContent = "";
  const w = $("delPlanWrap"); w.textContent = "";
  w.append(el("button", { class: "btn danger", type: "button", text: "Delete this plan", onclick: askDeletePlan }));
}
function renderFavCount() { $("favCount").textContent = state.favorites.length ? `(${state.favorites.length})` : ""; }
function renderBackup() { if (document.activeElement !== $("backupText")) $("backupText").value = JSON.stringify(state); }

function render() {
  preservingFocus(() => {
    renderBanners(); renderTheme(); renderPlans(); renderSummary(); renderLedger();
    renderTopics(); renderPlanForm(); renderFavCount(); renderBackup();
  });
}
/** Cheap refresh used by background link checks. */
function rerenderRows() { preservingFocus(() => { renderLedger(); renderSummary(); }); }
function commit() { save(); render(); }

/* ================= actions ================= */
function toggleDone(id, on) {
  const a = plan().articles.find((x) => x.id === id); if (!a) return;
  a.done = on; a.doneAt = on ? today() : null; commit();
  const st = planStats(plan(), today());
  if (on && st.done === st.total) toast(`Plan complete: ${st.total} articles, ${st.minutesAll} minutes of reading. Well done.`);
}
function move(i, d) {
  const A = plan().articles, j = i + d;
  if (j < 0 || j >= A.length) return;
  [A[i], A[j]] = [A[j], A[i]];
  const t = A[i].due; A[i].due = A[j].due; A[j].due = t; // keep the date slots, swap the articles in them
  commit();
}
function removeArticle(id) {
  const p = plan(), idx = p.articles.findIndex((a) => a.id === id);
  if (idx < 0) return;
  const [gone] = p.articles.splice(idx, 1);
  pendingDelete = null; commit();
  toast(`Removed “${short(gone.title)}”`, () => {
    const q = state.plans.find((x) => x.id === p.id);
    if (q && !q.articles.some((a) => a.id === gone.id)) { q.articles.splice(Math.min(idx, q.articles.length), 0, gone); commit(); }
  });
}
function addFavToPlan(f) {
  const p = plan();
  if (p.articles.some((a) => articleKey(a) === articleKey(f))) return;
  const a = newArticle({ ...f, due: nextDueDate(p, today()) }, p.start);
  p.articles.push(a); commit();
  toast(`Added “${short(f.title)}” to ${p.name}, due ${fmt(a.due)}`);
  if (a.url) queueCheck(p.id, a.id);
}

/* ================= toast ================= */
let toastTimer;
function toast(msg, undo) {
  const T = $("toast"); T.textContent = "";
  T.append(el("span", { text: msg }));
  if (undo) T.append(el("button", { type: "button", text: "Undo", onclick: () => { T.hidden = true; undo(); } }));
  T.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { T.hidden = true; }, undo ? 7000 : 4500);
}

/* ================= add form + live link inspection ================= */
const form = { url: $("aUrl"), title: $("aTitle"), topic: $("aTopic"), min: $("aMin"), due: $("aDue"), box: $("inspectBox"), err: $("aErr") };
let titleAuto = true;    // title still ours to fill
let minutesAuto = true;  // minutes still ours to fill
let lastInspected = null;
let inspectToken = 0;
let inspectTimer = null;

form.title.addEventListener("input", () => { titleAuto = !form.title.value.trim(); });
form.min.addEventListener("input", () => { minutesAuto = !form.min.value.trim(); });
form.url.addEventListener("input", () => { clearTimeout(inspectTimer); inspectTimer = setTimeout(runInspect, 700); });
form.url.addEventListener("paste", () => { clearTimeout(inspectTimer); inspectTimer = setTimeout(runInspect, 50); });
form.url.addEventListener("blur", () => { clearTimeout(inspectTimer); runInspect(); });

function showInspect(cls, text, spinner) {
  form.box.textContent = "";
  if (!text) return;
  form.box.append(el("span", { class: cls }, spinner ? el("span", { class: "spin", "aria-hidden": "true" }) : null, spinner ? " " : null, text));
}
async function runInspect() {
  const raw = form.url.value.trim();
  if (!raw) { showInspect("", ""); lastInspected = null; return; }
  const url = safeUrl(raw);
  if (!url) { showInspect("bad", "That doesn't look like a web address yet."); lastInspected = null; return; }
  const k = urlKey(url);
  if (k === lastInspected) return;
  lastInspected = k;
  const dup = plan().articles.find((a) => urlKey(a.url) === k);
  const token = ++inspectToken;
  if (dup) { showInspect("warn", `Already in this plan as “${short(dup.title, 60)}”.`); return; }
  showInspect("muted", "Checking the link and counting words…", true);
  const r = await inspectUrl(url);
  if (token !== inspectToken || urlKey(form.url.value) !== k) return; // reader moved on
  if (r.title && (titleAuto || !form.title.value.trim())) { form.title.value = r.title; titleAuto = true; }
  if (r.status === "ok" && Number.isInteger(r.minutes) && (minutesAuto || !form.min.value.trim())) { form.min.value = r.minutes; minutesAuto = true; }
  const words = Number.isInteger(r.words) && r.words > 0 ? ` · ${r.words.toLocaleString()} words` : "";
  if (r.status === "ok") showInspect(r.minutes ? "ok" : "warn", r.minutes ? `✓ Link works · about ${r.minutes} min read${words}` : "✓ Link works. " + r.message.replace(/^Link works,?\s*/i, ""));
  else if (r.status === "restricted") showInspect("warn", "? " + r.message);
  else if (["offline", "unavailable", "network", "rate_limited", "timeout", "unreachable"].includes(r.status)) showInspect("warn", "! " + r.message);
  else showInspect("bad", "✕ " + r.message);
  if (["offline", "network", "rate_limited"].includes(r.status)) lastInspected = null; // allow retry
}

$("addForm").addEventListener("submit", (e) => {
  e.preventDefault();
  const p = plan(), err = form.err; err.textContent = "";
  const rawUrl = form.url.value.trim();
  let url = "";
  if (rawUrl) { url = safeUrl(rawUrl); if (!url) { err.textContent = "That link doesn't look right. Use a full web address like https://example.com/article."; form.url.focus(); return; } }
  const title = form.title.value.trim() || (url ? new URL(url).hostname.replace(/^www\./, "") : "");
  if (!title) { err.textContent = "Add a link or a title so you know what to read."; form.url.focus(); return; }
  if (url && p.articles.some((a) => urlKey(a.url) === urlKey(url))) { err.textContent = "This link is already in the plan."; form.url.focus(); return; }
  let minutes = form.min.value.trim() === "" ? 10 : Number(form.min.value);
  if (!Number.isFinite(minutes) || minutes < 1 || minutes > 600) { err.textContent = "Read time must be between 1 and 600 minutes."; form.min.focus(); return; }
  let due = form.due.value;
  if (due && !parseISO(due)) { err.textContent = "Pick a valid due date."; form.due.focus(); return; }
  if (!due) due = nextDueDate(p, today());
  const auto = minutesAuto || form.min.value.trim() === "";
  const a = newArticle({ title, url, topic: form.topic.value, minutes, minutesAuto: auto, due }, p.start);
  p.articles.push(a);
  e.target.reset(); titleAuto = true; minutesAuto = true; lastInspected = null; showInspect("", "");
  if (filter === "done" || filter === "fav") setFilter("all");
  commit();
  toast(due < p.start || due > planEnd(p) ? "Added. Its due date is outside this plan's dates." : `Added “${short(title)}”, due ${fmt(due)}`);
  if (a.url) queueCheck(p.id, a.id);
  form.url.focus();
});

/* ================= toolbar ================= */
function setFilter(f) {
  filter = f; pendingDelete = null; editingId = null;
  document.querySelectorAll(".tabs button").forEach((x) => x.setAttribute("aria-pressed", String(x.dataset.f === f)));
  $("respaceBtn").disabled = $("checkAllBtn").disabled = f === "fav";
  renderLedger();
}
document.querySelectorAll(".tabs button").forEach((b) => b.addEventListener("click", () => setFilter(b.dataset.f)));
let searchTimer;
$("search").addEventListener("input", (e) => { clearTimeout(searchTimer); searchTimer = setTimeout(() => { query = e.target.value.trim(); renderLedger(); }, 150); });

$("respaceBtn").addEventListener("click", () => {
  const p = plan(); if (!p.articles.length) return;
  const before = p.articles.map((a) => a.due);
  spread(p.articles, p.start, p.days); commit();
  toast(`Due dates spread across ${plural(p.days, "day")}`, () => { p.articles.forEach((a, i) => { if (before[i]) a.due = before[i]; }); commit(); });
});
$("checkAllBtn").addEventListener("click", () => {
  if (!navigator.onLine) { toast("You're offline. Try again when you reconnect."); return; }
  if (apiState === "no") { toast("Link checks aren't available on this copy of Redart."); return; }
  const p = plan(), withLinks = p.articles.filter((a) => a.url);
  if (!withLinks.length) { toast("No links to check in this plan."); return; }
  withLinks.forEach((a) => queueCheck(p.id, a.id, true));
  toast(`Checking ${plural(withLinks.length, "link")}…`);
});

/* ================= plans ================= */
$("planSel").addEventListener("change", (e) => { state.active = e.target.value; pendingDelete = null; editingId = null; commit(); autoCheck(); });
$("newPlanBtn").addEventListener("click", () => { const d = $("newPlanPanel"); d.open = true; prefillNewPlan(); $("npName").focus(); d.scrollIntoView({ behavior: "smooth", block: "start" }); });
$("newPlanPanel").addEventListener("toggle", (e) => { if (e.target.open && !$("npStart").value) prefillNewPlan(); });
function prefillNewPlan() {
  let s = addDays(planEnd(plan()), 1);
  if (s < today()) s = today();
  $("npStart").value = s;
  let name = parseISO(s).toLocaleDateString(undefined, { month: "long", year: "numeric" }) + " reading";
  for (let n = 2; state.plans.some((p) => p.name.toLowerCase() === name.toLowerCase()); n++) name = name.replace(/( \(\d+\))?$/, ` (${n})`);
  $("npName").value = name;
  $("npErr").textContent = "";
}
$("newPlanForm").addEventListener("submit", (e) => {
  e.preventDefault();
  const err = $("npErr"); err.textContent = "";
  const name = $("npName").value.trim(), start = $("npStart").value, days = Number($("npDays").value), seed = $("npSeed").value;
  if (!name) { err.textContent = "Give the plan a name."; return; }
  if (!parseISO(start)) { err.textContent = "Pick a start date."; return; }
  if (!Number.isInteger(days) || days < 1 || days > 365) { err.textContent = "Length must be a whole number from 1 to 365 days."; return; }
  if (state.plans.some((p) => p.name.toLowerCase() === name.toLowerCase())) { err.textContent = "You already have a plan with that name."; return; }
  let articles = [];
  let note = "";
  if (seed === "starter") articles = articlesFromRows(STARTER, start, days).map((a) => ({ ...a, minutesAuto: true }));
  if (seed === "carry") {
    articles = spread(plan().articles.filter((a) => !a.done).map((a) => ({ ...a, id: uid(), done: false, doneAt: null })), start, days);
    if (!articles.length) note = " The current plan had no unread articles, so it starts empty.";
  }
  if (seed === "favorites") {
    articles = spread(state.favorites.map((f) => newArticle(f, start)), start, days);
    if (!articles.length) note = " You have no favourites yet, so it starts empty.";
  }
  const p = { id: uid(), name: name.slice(0, LIMITS.planName), start, days, articles };
  state.plans.push(p); state.active = p.id;
  $("newPlanPanel").open = false; $("npStart").value = "";
  setFilter("all"); commit(); autoCheck();
  toast(`Plan “${short(name)}” created.${note}`);
});
$("planForm").addEventListener("submit", (e) => {
  e.preventDefault();
  const p = plan(), err = $("pErr"); err.textContent = "";
  const name = $("pName").value.trim(), start = $("pStart").value, days = Number($("pDays").value);
  if (!name) { err.textContent = "Give the plan a name."; return; }
  if (!parseISO(start)) { err.textContent = "Pick a start date."; return; }
  if (!Number.isInteger(days) || days < 1 || days > 365) { err.textContent = "Length must be a whole number from 1 to 365 days."; return; }
  if (state.plans.some((q) => q.id !== p.id && q.name.toLowerCase() === name.toLowerCase())) { err.textContent = "Another plan already uses that name."; return; }
  const shift = diffDays(p.start, start);
  p.name = name.slice(0, LIMITS.planName); p.start = start; p.days = days;
  if (shift) p.articles.forEach((a) => { a.due = addDays(a.due, shift); }); // moving the start carries the dates with it
  commit();
  const outside = p.articles.filter((a) => a.due > planEnd(p)).length;
  toast((shift ? `Saved. Due dates moved ${plural(Math.abs(shift), "day")} ${shift > 0 ? "later" : "earlier"}.` : "Settings saved.") +
    (outside ? ` ${plural(outside, "article")} now fall after the plan ends; use “Spread dates” to fit them in.` : ""));
});
function askDeletePlan() {
  const w = $("delPlanWrap"); w.textContent = "";
  if (state.plans.length === 1) { w.append(el("span", { class: "err", text: "This is your only plan. Create another one before deleting it." })); return; }
  w.append(el("span", { class: "confirm" }, `Delete “${short(plan().name)}” and its notes? Favourites are kept.`,
    el("button", { class: "btn danger", type: "button", text: "Delete", onclick: deletePlan }),
    el("button", { class: "btn ghost", type: "button", text: "Cancel", onclick: renderPlanForm })));
}
function deletePlan() {
  const gone = plan(), idx = state.plans.indexOf(gone);
  state.plans.splice(idx, 1);
  state.active = [...state.plans].sort((a, b) => b.start.localeCompare(a.start))[0].id;
  $("planPanel").open = false; commit();
  toast(`Deleted “${short(gone.name)}”`, () => { state.plans.splice(Math.min(idx, state.plans.length), 0, gone); state.active = gone.id; commit(); });
}

/* ================= backup ================= */
$("copyBackup").addEventListener("click", () => {
  const ta = $("backupText"); ta.value = JSON.stringify(state);
  const msg = $("backupMsg");
  const fallback = () => { ta.focus(); ta.select(); msg.textContent = "Text selected. Press Ctrl+C, or long-press and choose Copy."; };
  try { navigator.clipboard.writeText(ta.value).then(() => { msg.textContent = "Copied. Paste it somewhere safe."; }, fallback); } catch { fallback(); }
});
$("restoreBackup").addEventListener("click", () => {
  const msg = $("backupMsg"), box = $("restoreConfirm"); msg.textContent = ""; box.textContent = "";
  let parsed = null;
  try { parsed = sanitizeState(JSON.parse($("backupText").value), today()); } catch { parsed = null; }
  if (!parsed) { msg.textContent = "That text isn't a Redart backup. Paste the full text you copied earlier."; return; }
  const n = parsed.plans.reduce((x, p) => x + p.articles.length, 0);
  box.append(el("span", { class: "confirm" }, `Replace everything here with ${plural(parsed.plans.length, "plan")}, ${plural(n, "article")} and ${plural(parsed.favorites.length, "favourite")}?`,
    el("button", { class: "btn danger", type: "button", text: "Replace", onclick: () => {
      const prev = state; state = parsed; box.textContent = ""; setFilter("all"); commit(); autoCheck();
      toast("Backup restored", () => { state = prev; commit(); });
    } }),
    el("button", { class: "btn ghost", type: "button", text: "Cancel", onclick: () => { box.textContent = ""; } })));
});

/* ================= theme, share, environment ================= */
$("themeBtn").addEventListener("click", () => {
  const order = ["system", "light", "dark"];
  state.prefs.theme = order[(order.indexOf(state.prefs.theme) + 1) % order.length];
  save(); renderTheme();
});
$("shareBtn").addEventListener("click", async () => {
  const data = { title: "Redart", text: "A reading ledger for engineers: plan your articles, tick them off, keep notes.", url: location.origin + "/" };
  if (navigator.share) { try { await navigator.share(data); return; } catch (e) { if (e && e.name === "AbortError") return; } }
  try { await navigator.clipboard.writeText(data.url); toast("Link copied. Paste it in your chat."); }
  catch { toast("Share this address: " + data.url); }
});
window.addEventListener("online", () => { renderBanners(); autoCheck(); });
window.addEventListener("offline", renderBanners);
// Another tab changed the ledger: take its version.
window.addEventListener("storage", (e) => {
  if (e.key !== KEY || !e.newValue) return;
  try { const s = sanitizeState(JSON.parse(e.newValue), today()); if (s) { state = s; render(); } } catch { /* ignore */ }
});
// Statuses depend on the date: refresh when the reader comes back (maybe on a new day).
let lastDay = today();
document.addEventListener("visibilitychange", () => {
  if (document.hidden) { if (saveTimer) save(); return; }
  if (today() !== lastDay) { lastDay = today(); render(); }
});

save();
render();
autoCheck();
