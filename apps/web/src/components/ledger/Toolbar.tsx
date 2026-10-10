"use client";
import { useEffect, useState } from "react";
import { useLedgerApi } from "./LedgerContext";
import s from "./Ledger.module.css";

export type Filter = "all" | "todo" | "done" | "fav";
const TABS: [Filter, string][] = [["all", "All"], ["todo", "To read"], ["done", "Done"], ["fav", "★ Favourites"]];

export function Toolbar({ filter, onFilter, onQuery }: { filter: Filter; onFilter: (f: Filter) => void; onQuery: (q: string) => void }) {
  const { state, spreadDates, checkAll } = useLedgerApi();
  const [text, setText] = useState("");
  useEffect(() => {
    const t = setTimeout(() => onQuery(text.trim()), 150);
    return () => clearTimeout(t);
  }, [text, onQuery]);
  const favCount = state.favorites.length;

  return (
    <div className={s.toolbar}>
      <div className={s.tabs} role="group" aria-label="Show">
        {TABS.map(([f, label]) => (
          <button key={f} type="button" aria-pressed={filter === f} onClick={() => onFilter(f)}>
            {label}{f === "fav" && favCount ? <> <span className={s.count}>({favCount})</span></> : null}
          </button>
        ))}
      </div>
      <div className={s.tools}>
        <label className="visually-hidden" htmlFor="search">Search articles</label>
        <input type="search" id="search" placeholder="Search title or topic" autoComplete="off" value={text} onChange={(e) => setText(e.target.value)} />
        <button className="btn" type="button" onClick={checkAll} disabled={filter === "fav"}>Check all links</button>
        <button className="btn" type="button" onClick={spreadDates} disabled={filter === "fav"} title="Spread due dates evenly across the plan">Spread dates</button>
      </div>
    </div>
  );
}
