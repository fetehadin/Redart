import Link from "next/link";
import type { UserCard } from "@redart/shared";
import { Avatar } from "../Avatar";
import { FollowButton } from "./FollowButton";
import styles from "./People.module.css";

export function UserRow({ user, action }: { user: UserCard; action?: React.ReactNode }) {
  return (
    <li className={styles.row}>
      <Avatar name={user.displayName} handle={user.handle} size={40} />
      <div className={styles.who}>
        <Link href={`/u/${user.handle}`} className={styles.name}>{user.displayName}</Link>
        <span className={styles.handle}>@{user.handle}{user.relationship?.followsYou === "accepted" ? " · follows you" : ""}</span>
        {user.bio ? <span className={styles.bio}>{user.bio}</span> : null}
      </div>
      <div className={styles.action}>
        {action ?? (user.relationship ? <FollowButton handle={user.handle} relationship={user.relationship} isPrivate={user.visibility === "PRIVATE"} /> : null)}
      </div>
    </li>
  );
}

export function UserList({ users, empty }: { users: UserCard[]; empty: string }) {
  if (!users.length) return <p className="quiet">{empty}</p>;
  return <ul className={styles.list}>{users.map((u) => <UserRow key={u.handle} user={u} />)}</ul>;
}
