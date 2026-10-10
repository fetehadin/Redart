import styles from "./Avatar.module.css";

// Muted hues that read well on both themes.
const HUES = [205, 160, 28, 345, 260, 95, 190, 10];

/** Initials on a muted colour picked from the handle, so a reader always gets the same one. */
export function Avatar({ name, handle, size = 32 }: { name: string; handle: string; size?: number }) {
  let h = 0;
  for (const ch of handle) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const hue = HUES[h % HUES.length]!;
  const initials = name.trim().split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() ?? "").join("") || handle[0]?.toUpperCase() || "?";
  return (
    <span className={styles.avatar} aria-hidden="true"
      style={{ width: size, height: size, fontSize: size * 0.4, ["--hue" as string]: hue }}>
      {initials}
    </span>
  );
}
