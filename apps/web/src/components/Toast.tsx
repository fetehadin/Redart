"use client";
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import styles from "./Toast.module.css";

type ShowToast = (message: string, undo?: () => void) => void;
const ToastContext = createContext<ShowToast>(() => {});
export const useToast = () => useContext(ToastContext);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<{ message: string; undo?: () => void; id: number } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const show = useCallback<ShowToast>((message, undo) => {
    clearTimeout(timer.current);
    setToast({ message, undo, id: Date.now() });
    timer.current = setTimeout(() => setToast(null), undo ? 7000 : 4500);
  }, []);
  useEffect(() => () => clearTimeout(timer.current), []);

  return (
    <ToastContext.Provider value={show}>
      {children}
      <div className={styles.toast} role="status" aria-live="polite" hidden={!toast}>
        {toast && <span key={toast.id}>{toast.message}</span>}
        {toast?.undo && (
          <button type="button" onClick={() => { const u = toast.undo; setToast(null); u?.(); }}>Undo</button>
        )}
      </div>
    </ToastContext.Provider>
  );
}
