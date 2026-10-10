import Link from "next/link";

export default function NotFound() {
  return (
    <div className="quiet">
      <p>There&apos;s no page at this address.</p>
      <p><Link href="/">Back to your ledger</Link></p>
    </div>
  );
}
