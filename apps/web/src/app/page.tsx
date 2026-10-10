import { LedgerApp } from "@/components/ledger/LedgerApp";
import { getCurrentUser } from "@/lib/session";

export default async function HomePage() {
  const member = await getCurrentUser();
  return (
    <>
      <noscript><p className="banner">Redart needs JavaScript turned on to work.</p></noscript>
      <LedgerApp member={member} />
    </>
  );
}
