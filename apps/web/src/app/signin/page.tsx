import type { Metadata } from "next";
import { redirect } from "next/navigation";
import type { AuthOptions } from "@redart/shared";
import { getCurrentUser, serverApi } from "@/lib/session";
import { SignInForm } from "./SignInForm";

export const metadata: Metadata = { title: "Sign in" };

export default async function SignInPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  if (await getCurrentUser()) redirect(next?.startsWith("/") && !next.startsWith("//") ? next : "/");
  const { data } = await serverApi<AuthOptions>("/api/auth/options");
  return <SignInForm next={next ?? null} passwordReset={!!data?.passwordReset} />;
}
