"use client";
import type { InputHTMLAttributes, ReactNode } from "react";
import { cx } from "@/lib/cx";
import styles from "./forms.module.css";

interface FieldProps extends InputHTMLAttributes<HTMLInputElement> {
  id: string;
  label: string;
  error?: string;
  hint?: ReactNode;
}

/** A labelled input with its error message tied to it for screen readers. */
export function Field({ id, label, error, hint, className, ...input }: FieldProps) {
  const describedBy = [error ? `${id}-err` : null, hint ? `${id}-hint` : null].filter(Boolean).join(" ") || undefined;
  return (
    <div className={cx(styles.field, className)}>
      <label className="lbl" htmlFor={id}>{label}</label>
      <input id={id} aria-invalid={error ? true : undefined} aria-describedby={describedBy} {...input} />
      {hint ? <span className="hint" id={`${id}-hint`}>{hint}</span> : null}
      {error ? <span className="err" id={`${id}-err`}>{error}</span> : null}
    </div>
  );
}

export function Card({ title, intro, children }: { title: string; intro?: ReactNode; children: ReactNode }) {
  return (
    <section className={styles.card}>
      <h1>{title}</h1>
      {intro ? <p className={styles.intro}>{intro}</p> : null}
      {children}
    </section>
  );
}

/** Only follow ?next= links that stay on this site. */
export function safeNext(next: string | null | undefined): string {
  return next && next.startsWith("/") && !next.startsWith("//") && !next.startsWith("/\\") ? next : "/";
}
