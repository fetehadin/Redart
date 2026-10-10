import type { Metadata } from "next";
import { redirect } from "next/navigation";
import type { UserCard } from "@redart/shared";
import { getCurrentUser, serverApi } from "@/lib/session";
import { PeopleSearch } from "@/components/people/PeopleSearch";
import { FollowRequests } from "@/components/people/FollowRequests";
import styles from "@/components/people/People.module.css";

export const metadata: Metadata = { title: "People" };

export default async function PeoplePage() {
  const me = await getCurrentUser();
  if (!me) redirect("/signin?next=/people");
  const { data } = await serverApi<{ items: UserCard[] }>("/api/follow-requests");
  return (
    <section className={styles.page}>
      <h1 className={styles.title}>People</h1>
      {data?.items.length ? <FollowRequests initial={data.items} /> : null}
      <PeopleSearch />
    </section>
  );
}
