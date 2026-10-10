"use client";
import { useEffect, useState } from "react";
import type { UserCard } from "@redart/shared";
import { api } from "@/lib/api";
import { UserList } from "./UserList";
import styles from "./People.module.css";

export function PeopleSearch() {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<{ q: string; items: UserCard[] } | null>(null);

  useEffect(() => {
    const query = q.trim();
    if (!query) return;
    let live = true;
    const t = setTimeout(async () => {
      try {
        const { items } = await api<{ items: UserCard[] }>(`/api/users/search?q=${encodeURIComponent(query)}`);
        if (live) setResults({ q: query, items });
      } catch { if (live) setResults({ q: query, items: [] }); }
    }, 250);
    return () => { live = false; clearTimeout(t); };
  }, [q]);

  const showing = q.trim() && results?.q === q.trim() ? results : null;
  return (
    <>
      <h2 className={styles.subtitle}>Find readers</h2>
      <label className="visually-hidden" htmlFor="peopleSearch">Search by name or handle</label>
      <input id="peopleSearch" type="search" placeholder="Search by name or @handle" autoComplete="off" value={q} onChange={(e) => setQ(e.target.value)} />
      {showing ? <UserList users={showing.items} empty={`No one matches “${showing.q}”.`} />
        : !q.trim() ? <p className="hint">Find friends and colleagues by their name or handle, then follow them to see what they&apos;re reading.</p> : null}
    </>
  );
}
