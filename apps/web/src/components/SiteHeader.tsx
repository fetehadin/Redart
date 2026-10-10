import Link from "next/link";
import { ThemeToggle } from "./ThemeToggle";
import styles from "./SiteHeader.module.css";

export function SiteHeader() {
  return (
    <header className={styles.masthead}>
      <div className={styles.brand}>
        <Link href="/" className={styles.home}>
          <span className={styles.mark} aria-hidden="true">R</span>Redart
        </Link>
        <p>A reading ledger for engineers. Plan your articles, tick them off, keep a note on each.</p>
      </div>
      <nav className={styles.nav} aria-label="Site">
        <ThemeToggle />
      </nav>
    </header>
  );
}
