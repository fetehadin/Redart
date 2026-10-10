import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { Settings } from "./Settings";

export const metadata: Metadata = { title: "Settings" };

export default async function SettingsPage() {
  const me = await getCurrentUser();
  if (!me) redirect("/signin?next=/settings");
  return <Settings me={me} />;
}
