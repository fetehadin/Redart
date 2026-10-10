import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { NewChallengeForm } from "@/components/challenges/NewChallengeForm";

export const metadata: Metadata = { title: "Start a challenge" };

export default async function NewChallengePage() {
  const me = await getCurrentUser();
  if (!me) redirect("/signin?next=/challenges/new");
  return <NewChallengeForm isAdmin={me.isAdmin} />;
}
