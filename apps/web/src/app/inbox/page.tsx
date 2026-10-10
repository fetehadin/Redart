import type { Metadata } from "next";
import { redirect } from "next/navigation";
import type { NotificationItem, Page } from "@redart/shared";
import { getCurrentUser, serverApi } from "@/lib/session";
import { Inbox } from "@/components/social/Inbox";
import styles from "@/components/social/Social.module.css";

export const metadata: Metadata = { title: "Inbox" };

export default async function InboxPage() {
  if (!(await getCurrentUser())) redirect("/signin?next=/inbox");
  const { data } = await serverApi<Page<NotificationItem>>("/api/notifications");
  return (
    <section className={styles.page}>
      <h1 className={styles.title}>Inbox</h1>
      <Inbox items={data?.items ?? []} />
    </section>
  );
}
