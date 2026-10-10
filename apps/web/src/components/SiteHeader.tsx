import Link from "next/link";
import type { Me } from "@redart/shared";
import { ThemeToggle } from "./ThemeToggle";
import { AccountMenu } from "./AccountMenu";
import styles from "./SiteHeader.module.css";

export function SiteHeader({ member, unread = 0 }: { member: Me | null; unread?: number }) {
  return (
    <header className={styles.masthead}>
      <div className={styles.brand}>
        <Link href="/" className={styles.home}>
          <span className={styles.mark} aria-hidden="true">R</span>Redart
        </Link>
        <p>
          A reading ledger for engineers. Plan your articles, tick them off, keep a note on each.
          {member ? null : " No account needed; sign in to sync across devices and read alongside friends."}
        </p>
      </div>
      <nav className={styles.nav} aria-label="Site">
        <Link href="/" className={styles.link}>Ledger</Link>
        {member ? <Link href="/feed" className={styles.link}>Feed</Link> : null}
        <Link href="/challenges" className={styles.link}>Challenges</Link>
        {member ? <Link href="/people" className={styles.link}>People</Link> : null}
        {member ? (
          <Link href="/inbox" className={styles.link} aria-label={unread ? `Inbox, ${unread} new` : "Inbox"}>
            Inbox{unread ? <span className={styles.badge} aria-hidden="true">{unread > 99 ? "99+" : unread}</span> : null}
          </Link>
        ) : null}
        {member ? <AccountMenu member={member} /> : <Link href="/signin" className="btn">Sign in</Link>}
        <ThemeToggle />
      </nav>
    </header>
  );
}
