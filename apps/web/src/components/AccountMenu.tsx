"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import type { Me } from "@redart/shared";
import { api } from "@/lib/api";
import { clearMemberData } from "@/lib/store/remote";
import { Avatar } from "./Avatar";
import styles from "./AccountMenu.module.css";

export function AccountMenu({ member }: { member: Me }) {
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === "Escape" : !box.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    return () => { document.removeEventListener("mousedown", close); document.removeEventListener("keydown", close); };
  }, [open]);

  async function signOut() {
    try { await api("/api/auth/signout", { body: {} }); } catch { /* signed out locally anyway */ }
    try { clearMemberData(window.localStorage); } catch { /* ignore */ }
    setOpen(false);
    router.push("/");
    router.refresh();
  }

  return (
    <div className={styles.menu} ref={box}>
      <button type="button" className={styles.trigger} aria-expanded={open} aria-haspopup="true" onClick={() => setOpen((o) => !o)}>
        <Avatar name={member.displayName} handle={member.handle} size={28} />
        <span className={styles.handle}>@{member.handle}</span>
      </button>
      {open && (
        <div className={styles.panel}>
          <p className={styles.who}><strong>{member.displayName}</strong><br /><span>{member.email}</span></p>
          <Link href={`/u/${member.handle}`} onClick={() => setOpen(false)}>Your profile</Link>
          <Link href="/settings" onClick={() => setOpen(false)}>Settings</Link>
          <button type="button" onClick={signOut}>Sign out</button>
        </div>
      )}
    </div>
  );
}
