import type { Metadata } from "next";
import type { AuthOptions } from "@redart/shared";
import { serverApi } from "@/lib/session";
import { Card } from "@/components/forms";
import { ResetForm } from "./ResetForm";

export const metadata: Metadata = { title: "Reset your password" };

export default async function ResetPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token } = await searchParams;
  const { data } = await serverApi<AuthOptions>("/api/auth/options");
  if (!data?.passwordReset) {
    return (
      <Card title="Reset your password">
        <p>Password reset by email isn&apos;t set up on this site yet. Ask the person who runs it to reset your password for you.</p>
      </Card>
    );
  }
  return <ResetForm token={token ?? null} />;
}
