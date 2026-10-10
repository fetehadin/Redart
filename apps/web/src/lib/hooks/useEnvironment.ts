"use client";
import { useEffect, useState, useSyncExternalStore } from "react";
import { todayISO, type ISODate } from "@redart/shared";

function subscribeOnline(cb: () => void) {
  window.addEventListener("online", cb);
  window.addEventListener("offline", cb);
  return () => { window.removeEventListener("online", cb); window.removeEventListener("offline", cb); };
}
export const useOnline = () => useSyncExternalStore(subscribeOnline, () => navigator.onLine, () => true);

/** Today's local date; refreshes when the reader comes back to the tab, maybe on a new day. */
export function useToday(): ISODate {
  const [today, setToday] = useState(todayISO);
  useEffect(() => {
    const refresh = () => { if (!document.hidden) setToday(todayISO()); };
    document.addEventListener("visibilitychange", refresh);
    const timer = setInterval(refresh, 60_000);
    return () => { document.removeEventListener("visibilitychange", refresh); clearInterval(timer); };
  }, []);
  return today;
}
