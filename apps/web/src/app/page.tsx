import { LedgerApp } from "@/components/ledger/LedgerApp";

export default function HomePage() {
  return (
    <>
      <noscript><p className="banner">Redart needs JavaScript turned on to work.</p></noscript>
      <LedgerApp />
    </>
  );
}
