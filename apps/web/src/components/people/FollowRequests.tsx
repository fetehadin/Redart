"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { UserCard } from "@redart/shared";
import { api } from "@/lib/api";
import { useToast } from "../Toast";
import { UserRow } from "./UserList";
import styles from "./People.module.css";

export function FollowRequests({ initial }: { initial: UserCard[] }) {
  const [items, setItems] = useState(initial);
  const toast = useToast();
  const router = useRouter();
  if (!items.length) return null;

  async function decide(handle: string, decision: "accept" | "decline") {
    try {
      await api(`/api/follow-requests/${handle}/${decision}`, { body: {} });
      setItems((list) => list.filter((u) => u.handle !== handle));
      toast(decision === "accept" ? `@${handle} can now see your reading.` : "Request declined.");
      router.refresh();
    } catch { toast("Couldn't do that right now."); }
  }

  return (
    <>
      <h2 className={styles.subtitle}>Asking to follow you</h2>
      <ul className={styles.list}>
        {items.map((u) => (
          <UserRow key={u.handle} user={u} action={<>
            <button className="btn solid" type="button" onClick={() => decide(u.handle, "accept")}>Accept</button>
            <button className="btn" type="button" onClick={() => decide(u.handle, "decline")}>Decline</button>
          </>} />
        ))}
      </ul>
    </>
  );
}
