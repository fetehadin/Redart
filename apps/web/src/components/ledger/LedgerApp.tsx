"use client";
import { useCallback, useMemo, useState } from "react";
import Link from "next/link";
import type { Me } from "@redart/shared";
import { plural } from "@/lib/format";
import { useOnline } from "@/lib/hooks/useEnvironment";
import { LedgerProvider, useLedgerApi } from "./LedgerContext";
import { PlanBar } from "./PlanBar";
import { Summary } from "./Summary";
import { Toolbar, type Filter } from "./Toolbar";
import { ArticleList } from "./ArticleList";
import { AddArticle, Backup, NewPlan, Panel, PlanSettings } from "./Panels";

export function LedgerApp({ member }: { member: Me | null }) {
  return (
    <LedgerProvider member={member} fallback={<p className="quiet">Loading your ledger…</p>}>
      <Ledger />
    </LedgerProvider>
  );
}

function Banners() {
  const { problem, member, guestLedger, importGuestLedger, dismissGuestLedger } = useLedgerApi();
  const online = useOnline();
  const [importing, setImporting] = useState(false);
  return (
    <>
      {guestLedger && (
        <div className="banner info" role="region" aria-label="Reading saved on this device">
          This device has {plural(guestLedger.plans, "plan")} with {plural(guestLedger.articles, "article")} from before you signed in.
          Add them to your account? Nothing in your account is replaced.{" "}
          <span className="confirm">
            <button className="btn solid" type="button" disabled={importing}
              onClick={async () => { setImporting(true); await importGuestLedger(); setImporting(false); }}>
              {importing ? "Adding…" : "Add to my account"}
            </button>
            <button className="btn ghost" type="button" onClick={dismissGuestLedger}>Not now</button>
          </span>
        </div>
      )}
      {problem === "unsynced" && (
        <p className="banner">Some changes haven&apos;t reached your account yet. They&apos;re kept on this device and will be saved as soon as Redart can reach the server.</p>
      )}
      {problem === "rejected" && (
        <p className="banner">A change couldn&apos;t be saved, so your ledger was reloaded from your account. Try it again.</p>
      )}
      {problem === "signed-out" && (
        <p className="banner">You&apos;ve been signed out, so changes can&apos;t be saved. <Link href="/signin">Sign in again</Link>.</p>
      )}
      {problem === "blocked" && (
        <p className="banner">This browser is blocking saved data (private mode or blocked site data). You can use Redart, but your progress will be lost when you close the page. Use “Backup” at the bottom to keep a copy.</p>
      )}
      {problem === "quota" && (
        <p className="banner">Storage is full, so recent changes aren&apos;t saved. Copy a backup, then delete old plans to free space.</p>
      )}
      {!online && (
        <p className="banner info">
          {member
            ? "You're offline. Keep reading; your changes will be saved when you reconnect."
            : "You're offline. Everything still works; link checks will run when you're back online."}
        </p>
      )}
    </>
  );
}

function TopicList() {
  const { state } = useLedgerApi();
  const topics = useMemo(() => {
    const set = new Set<string>();
    state.plans.forEach((p) => p.articles.forEach((a) => a.topic && set.add(a.topic)));
    state.favorites.forEach((f) => f.topic && set.add(f.topic));
    return [...set].sort((a, b) => a.localeCompare(b));
  }, [state]);
  return <datalist id="topicList">{topics.map((t) => <option key={t} value={t} />)}</datalist>;
}

function Ledger() {
  const { plan, member } = useLedgerApi();
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");
  const [newPlanOpen, setNewPlanOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(true);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [backupOpen, setBackupOpen] = useState(false);
  const onQuery = useCallback((q: string) => setQuery(q), []);

  const openNewPlan = () => {
    setNewPlanOpen(true);
    requestAnimationFrame(() => document.getElementById("newPlanPanel")?.scrollIntoView({ behavior: "smooth", block: "start" }));
  };
  const openAdd = () => {
    setAddOpen(true);
    requestAnimationFrame(() => document.getElementById("aUrl")?.focus());
  };

  return (
    <>
      <PlanBar onNewPlan={openNewPlan} />
      <Banners />
      <Summary />

      <Panel id="newPlanPanel" title="Start a new plan" open={newPlanOpen} onOpenChange={setNewPlanOpen}>
        {/* Mounted only while open, so its suggested name and start date are fresh each time. */}
        {newPlanOpen && <NewPlan onCreated={() => { setNewPlanOpen(false); setFilter("all"); }} />}
      </Panel>

      <Toolbar filter={filter} onFilter={setFilter} onQuery={onQuery} />
      <ArticleList filter={filter} query={query} onAddArticle={openAdd} />

      <Panel id="addPanel" title="Add an article" open={addOpen} onOpenChange={setAddOpen}>
        <AddArticle onAdded={() => { if (filter === "done" || filter === "fav") setFilter("all"); }} />
      </Panel>

      <Panel id="planPanel" title="Plan settings" open={settingsOpen} onOpenChange={setSettingsOpen}>
        <PlanSettings key={`${plan.id}:${plan.name}:${plan.start}:${plan.days}`} onSaved={() => setSettingsOpen(false)} />
      </Panel>

      <Panel id="backupPanel" title={member ? "Backup" : "Backup and move to another device"} open={backupOpen} onOpenChange={setBackupOpen}>
        <Backup />
      </Panel>

      <TopicList />
    </>
  );
}
