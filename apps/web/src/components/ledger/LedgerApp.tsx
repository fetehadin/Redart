"use client";
import { useCallback, useMemo, useState } from "react";
import { useOnline } from "@/lib/hooks/useEnvironment";
import { LedgerProvider, useLedgerApi } from "./LedgerContext";
import { PlanBar } from "./PlanBar";
import { Summary } from "./Summary";
import { Toolbar, type Filter } from "./Toolbar";
import { ArticleList } from "./ArticleList";
import { AddArticle, Backup, NewPlan, Panel, PlanSettings } from "./Panels";

export function LedgerApp() {
  return (
    <LedgerProvider fallback={<p className="quiet">Loading your ledger…</p>}>
      <Ledger />
    </LedgerProvider>
  );
}

function Banners() {
  const { problem } = useLedgerApi();
  const online = useOnline();
  return (
    <>
      {problem === "blocked" && (
        <p className="banner">This browser is blocking saved data (private mode or blocked site data). You can use Redart, but your progress will be lost when you close the page. Use “Backup” at the bottom to keep a copy.</p>
      )}
      {problem === "quota" && (
        <p className="banner">Storage is full, so recent changes aren&apos;t saved. Copy a backup, then delete old plans to free space.</p>
      )}
      {!online && <p className="banner info">You&apos;re offline. Everything still works; link checks will run when you&apos;re back online.</p>}
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
  const { plan } = useLedgerApi();
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

      <Panel id="backupPanel" title="Backup and move to another device" open={backupOpen} onOpenChange={setBackupOpen}>
        <Backup />
      </Panel>

      <TopicList />
    </>
  );
}
