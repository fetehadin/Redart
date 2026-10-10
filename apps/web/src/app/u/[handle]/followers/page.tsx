import type { Metadata } from "next";
import { FollowList } from "@/components/people/FollowList";

export const metadata: Metadata = { title: "Followers" };

export default async function Page({ params }: { params: Promise<{ handle: string }> }) {
  return <FollowList handle={(await params).handle} dir="followers" />;
}
