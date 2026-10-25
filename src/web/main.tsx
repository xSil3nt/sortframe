import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import type { CraftPlan } from "../shared/craft.js";
import type { Snapshot, Settings, PlannedItem } from "../shared/models.js";
import type { Quote } from "../shared/models.js";
import "./style.css";

type Page = "Inventory" | "Listings" | "Settings";

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, { ...init, headers: { ...(init?.body ? { "content-type": "application/json" } : {}), ...init?.headers } });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error ?? `Request failed (${response.status})`);
  }
  return response.json();
}

function App() {
  const [page, setPage] = useState<Page>("Inventory");
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [plan, setPlan] = useState<CraftPlan | null>(null);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [selected, setSelected] = useState<PlannedItem | null>(null);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("All items");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [quotes, setQuotes] = useState<Record<string, Quote | null>>({});
  const [quoteStatus, setQuoteStatus] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);

  const refresh = useCallback(async () => {
    const [nextSnapshot, nextPlan, nextSettings] = await Promise.all([api<Snapshot>("/api/snapshot"), api<CraftPlan>("/api/plan"), api<Settings>("/api/settings")]);
    setSnapshot(nextSnapshot);
    setPlan(nextPlan);
    setSettings(nextSettings);
  }, []);

  useEffect(() => { refresh().catch((error) => setNotice(error.message)); }, [refresh]);
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        searchRef.current?.focus();
      }
      if (event.key === "Escape") setSelected(null);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const refreshQuotes = useCallback(async (current: Snapshot) => {
    const ids = current.entries.filter((item) => item.prime).map((item) => item.id);
    if (!ids.length) { setQuoteStatus("No Prime items to price"); return; }
    setQuoteStatus("Refreshing PC prices…");
    try {
      const nextQuotes: Record<string, Quote | null> = {};
      for (let start = 0; start < ids.length; start += 40) {
        const chunk = ids.slice(start, start + 40);
        const result = await api<{ quotes: { itemId: string; quote: Quote | null }[] }>(`/api/quotes?itemIds=${encodeURIComponent(chunk.join(","))}&platform=pc&crossplay=false`);
        for (const entry of result.quotes) nextQuotes[entry.itemId] = entry.quote;
        setQuotes({ ...nextQuotes });
        setQuoteStatus(`Refreshing PC prices · ${Math.min(start + chunk.length, ids.length)}/${ids.length}`);
      }
      setPlan(await api<CraftPlan>("/api/plan"));
      setQuoteStatus(`PC quotes · ${new Date().toLocaleTimeString()}`);
    } catch { setQuoteStatus("Prices unavailable"); }
  }, []);

  useEffect(() => { if (snapshot && snapshot.source !== "demo") void refreshQuotes(snapshot); }, [snapshot, refreshQuotes]);

  const rows = useMemo(() => (plan?.items ?? []).filter((item) => {
    const matchesQuery = item.name.toLowerCase().includes(query.toLowerCase());
    return matchesQuery && (filter === "All items" || item.recommendation === filter);
  }), [plan, query, filter]);

  const counts = useMemo(() => (plan?.items ?? []).reduce((result, item) => {
    result[item.recommendation] = (result[item.recommendation] ?? 0) + item.surplus;
    return result;
  }, {} as Record<string, number>), [plan]);

  const setThreshold = async (value: number) => {
    if (!settings) return;
    const next = { ...settings, platinumThreshold: value };
    setSettings(next);
    await api("/api/settings", { method: "PUT", body: JSON.stringify(next) });
    await refresh();
  };

  const importFile = async (file?: File) => {
    if (!file) return;
    setBusy(true);
    try {
      const parsed = JSON.parse(await file.text());
      const path = Array.isArray(parsed?.entries) ? "/api/import" : "/api/import-companion";
      await api(path, { method: "POST", body: JSON.stringify(parsed) });
      await refresh();
      setNotice("Inventory imported.");
    } catch (error) { setNotice(error instanceof Error ? error.message : "Import failed."); }
    finally { setBusy(false); }
  };

  const resetDemo = async () => {
    await api("/api/demo/reset", { method: "POST", body: "{}" });
    await refresh();
    setNotice("Demo inventory loaded.");
  };

  const syncInventory = async () => {
    setBusy(true);
    setNotice("Sign in through Steam to sync your Warframe inventory. Sortframe will not end an active game session.");
    try {
      await api<Snapshot>("/api/warframe/steam/sync", { method: "POST", body: "{}" });
      await refresh();
      setNotice("Warframe companion inventory synced.");
    } catch (error) { setNotice(error instanceof Error ? error.message : "Inventory sync failed. Your saved snapshot was kept."); }
    finally { setBusy(false); }
  };

  const saveItemSettings = async (next: Settings) => {
    await api("/api/settings", { method: "PUT", body: JSON.stringify(next) });
    await refresh();
  };

  const quit = async () => {
    await api("/api/quit", { method: "POST", body: "{}" });
    setNotice("Sortframe has closed. You can close this tab.");
  };

  if (!snapshot || !plan || !settings) return <main className="loading">{notice || "Loading inventory…"}</main>;

  return <div className="app-shell">
    <aside className="sidebar">
      <a className="brand" href="#inventory" aria-label="Sortframe home"><span className="brand-mark">S</span><span>Sortframe</span></a>
      <nav aria-label="Main navigation">
        {(["Inventory", "Listings", "Settings"] as Page[]).map((item) => <button key={item} className={`nav-link ${page === item ? "active" : ""}`} onClick={() => setPage(item)}><span className="nav-icon">{item === "Inventory" ? "◫" : item === "Listings" ? "⇧" : "⚙"}</span>{item}{item === "Listings" && <span className="nav-count">{counts["Sell for platinum"] ?? 0}</span>}</button>)}
      </nav>
      <div className="sidebar-bottom">
        <div className="connection-chip"><span className="status-dot"/><span><strong>{snapshot.source === "demo" ? "Demo data" : "Inventory loaded"}</strong><small>{snapshot.source === "demo" ? "Local only" : snapshot.source}</small></span></div>
        <button className="quit-button" onClick={quit}>Quit Sortframe</button>
      </div>
    </aside>

    <main className="main-area">
      <header className="topbar"><div className="breadcrumbs">Sortframe <span>/</span> {page}</div><div className="top-actions"><span className={`sync-label ${snapshot.source === "demo" ? "demo" : ""}`}><i/> {snapshot.source === "demo" ? "Demo inventory" : `Synced ${new Date(snapshot.capturedAt).toLocaleString()}`}</span><label className="button secondary upload-button">Import JSON<input type="file" accept="application/json,.json" onChange={(event) => importFile(event.target.files?.[0])} disabled={busy}/></label><a className="button secondary" href="/api/export">Export</a></div></header>
      {notice && <div className="notice" role="status">{notice}<button onClick={() => setNotice("")} aria-label="Dismiss">×</button></div>}

      {page === "Inventory" && <section>
        <div className="page-heading"><div><p className="eyebrow">COLLECTION PLANNER</p><h1>Prime inventory</h1><p className="subheading">Protect what you need. Sort the spare parts.</p></div><div className="heading-actions"><button className="button secondary" onClick={() => void refreshQuotes(snapshot)}>{quoteStatus || "Refresh PC prices"}</button><button className="button primary" onClick={() => void syncInventory()} disabled={busy}>{busy ? "Connecting to Steam…" : "Sync inventory"} <span>↻</span></button></div></div>
        <div className="summary-strip"><div className="summary-item"><span>Items in snapshot</span><strong>{snapshot.entries.length}</strong></div><div className="summary-item"><span>Protected for collection</span><strong>{plan.items.reduce((sum, item) => sum + item.reserved, 0)}</strong></div><div className="summary-item"><span>Platinum candidates</span><strong>{counts["Sell for platinum"] ?? 0}</strong></div><div className="summary-item"><span>Ducat candidates</span><strong>{counts.Ducats ?? 0}</strong></div></div>
        <div className="table-toolbar"><div className="filter-tabs">{["All items", "Keep", "Sell for platinum", "Ducats", "Check"].map((item) => <button key={item} className={filter === item ? "selected" : ""} onClick={() => setFilter(item)}>{item}{item !== "All items" && <span>{counts[item] ?? 0}</span>}</button>)}</div><label className="search"><span>⌕</span><input ref={searchRef} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Find a Prime item"/><kbd>Ctrl K</kbd></label></div>
        <div className="table-wrap"><table><thead><tr><th>ITEM</th><th>OWNED</th><th>RESERVED</th><th>PENDING</th><th>SURPLUS</th><th>SELLER ASK</th><th>BUYER OFFER</th><th>DUCATS</th><th>PLAN</th></tr></thead><tbody>{rows.map((item) => { const quote = quotes[item.id]; return <tr key={item.id} className="item-row" onClick={() => setSelected(item)} tabIndex={0} onKeyDown={(event) => { if (event.key === "Enter") setSelected(item); }}><td><span className={`item-icon ${item.kind}`}>{item.kind === "equipment" ? "◈" : "◆"}</span><span className="item-title"><strong>{item.name}</strong><small>{item.category}{item.mastered ? " · Mastered" : ""}</small></span></td><td>{item.quantity}</td><td className="muted-number">{item.reserved}</td><td className="muted-number">{item.pendingQuantity}</td><td className={item.surplus > 0 ? "surplus-number" : "muted-number"}>{item.surplus}</td><td title={quote?.medianFiveAsks !== null && quote?.medianFiveAsks !== undefined ? `Median of five lowest asks: ${quote.medianFiveAsks}p` : undefined}>{quote?.lowestAsk !== undefined && quote.lowestAsk !== null ? `${quote.lowestAsk}p` : item.platinumAsk !== undefined ? `${item.platinumAsk}p` : <span className="no-quote">—</span>}</td><td>{quote?.highestBid !== undefined && quote.highestBid !== null ? `${quote.highestBid}p` : <span className="no-quote">—</span>}</td><td>{item.ducats ?? <span className="no-quote">—</span>}</td><td><span className={`decision ${slug(item.recommendation)}`}>{item.recommendation}</span></td></tr>; })}</tbody></table>{rows.length === 0 && <div className="empty-state">No items match this filter.</div>}</div>
        <div className="table-foot"><span>Snapshot from {new Date(snapshot.capturedAt).toLocaleString()} · {snapshot.source}</span><button className="text-button" onClick={resetDemo}>Reload demo data</button></div>
      </section>}

      {page === "Listings" && <section><div className="page-heading"><div><p className="eyebrow">WARFRAME.MARKET</p><h1>Listing review</h1><p className="subheading">Check surplus items and prices before creating orders.</p></div><button className="button primary" onClick={() => setNotice("Marketplace publishing is not enabled until authenticated API access is validated.")}>Review selected</button></div><div className="integration-panel"><div className="integration-icon">↗</div><div><h2>Connect your marketplace account</h2><p>Price data and publishing are not connected yet. The public item catalog is planned to work without an API key.</p><button className="button secondary" onClick={() => setNotice("Marketplace sign-in is not connected in this build. No credentials were sent.")}>Sign in to warframe.market</button></div></div><div className="table-wrap listing-table"><table><thead><tr><th>ITEM</th><th>SURPLUS</th><th>LOWEST ASK</th><th>BEST OFFER</th><th>STATUS</th></tr></thead><tbody>{plan.items.filter((item) => item.recommendation === "Sell for platinum").map((item) => <tr key={item.id}><td><strong>{item.name}</strong></td><td>{item.surplus}</td><td>{item.platinumAsk ? `${item.platinumAsk}p` : "—"}</td><td className="no-quote">—</td><td><span className="decision check">Price preview</span></td></tr>)}</tbody></table></div></section>}

      {page === "Settings" && <section><div className="page-heading"><div><p className="eyebrow">PREFERENCES</p><h1>Settings</h1><p className="subheading">Set the collection and listing rules Sortframe uses.</p></div></div><div className="settings-grid"><div className="settings-panel"><div className="panel-heading"><div><h2>Collection target</h2><p>Keep one copy of every Prime item, including mastered gear you sold.</p></div><span className="setting-badge">Default</span></div><label className="field-label">Planning mode<select value={settings.mode} onChange={async (event) => { const next = { ...settings, mode: event.target.value as Settings["mode"] }; await api("/api/settings", { method: "PUT", body: JSON.stringify(next) }); await refresh(); }}><option value="collection">Complete Prime collection</option><option value="mastery">Mastery only</option></select></label><div className="rule-row"><span>Reserve parts for dual weapons</span><strong>On</strong></div><div className="rule-row"><span>Protect invested equipment</span><strong>On</strong></div><div className="rule-row"><span>Hold unknown recipes for review</span><strong>On</strong></div></div><div className="settings-panel"><div className="panel-heading"><div><h2>Platinum threshold</h2><p>Surplus items at or above this price are marked to sell.</p></div></div><label className="field-label">Minimum seller ask<input type="number" min="0" step="1" value={settings.platinumThreshold} onChange={(event) => void setThreshold(Math.max(0, Number(event.target.value)))}/></label><p className="hint">Collection reserves stay protected at every price.</p></div><div className="settings-panel full-panel"><div className="panel-heading"><div><h2>Connections</h2><p>Warframe inventory and marketplace accounts use separate sign-ins.</p></div></div><div className="account-row"><span className="account-glyph">W</span><span><strong>Warframe</strong><small>Sign in with Steam to sync the companion inventory</small></span><button className="button secondary" onClick={() => void syncInventory()} disabled={busy}>Connect with Steam</button></div><div className="account-row"><span className="account-glyph market">M</span><span><strong>warframe.market</strong><small>Email sign-in and order management</small></span><button className="button secondary" onClick={() => setNotice("Marketplace authentication is still being validated. No login details were sent.")}>Connect</button></div></div><div className="settings-panel full-panel"><div className="panel-heading"><div><h2>Local data</h2><p>Inventory and settings stay on this Windows account.</p></div></div><div className="rule-row"><span>Snapshot source</span><strong>{snapshot.source}</strong></div><div className="rule-row"><span>Last updated</span><strong>{new Date(snapshot.capturedAt).toLocaleString()}</strong></div><a className="button secondary" href="/api/export">Export inventory JSON</a></div></div></section>}
    </main>

    {selected && <div className="overlay" onMouseDown={(event) => { if (event.target === event.currentTarget) setSelected(null); }}><aside className="detail-drawer" role="dialog" aria-modal="true" aria-labelledby="detail-title"><div className="drawer-head"><div><p className="eyebrow">ITEM PLAN</p><h2 id="detail-title">{selected.name}</h2></div><button className="close-button" onClick={() => setSelected(null)} aria-label="Close">×</button></div><div className="detail-stats"><div><span>Owned</span><strong>{selected.quantity}</strong></div><div><span>Reserved</span><strong>{selected.reserved}</strong></div><div><span>Surplus</span><strong>{selected.surplus}</strong></div></div><div className="detail-section"><h3>Recommendation</h3><span className={`decision ${slug(selected.recommendation)}`}>{selected.recommendation}</span><p>{explanation(selected)}</p></div><div className="detail-section"><h3>Collection target</h3><label className="field-label">Copies to keep<input type="number" min="0" value={settings.targets[selected.id] ?? (settings.mode === "collection" ? 1 : Number(selected.mastered))} onChange={(event) => { const next = { ...settings, targets: { ...settings.targets, [selected.id]: Math.max(0, Number(event.target.value)) } }; setSettings(next); }} onBlur={() => void saveItemSettings(settings)}/></label><label className="check-row"><input type="checkbox" checked={settings.excluded.includes(selected.id)} onChange={async (event) => { const excluded = event.target.checked ? [...new Set([...settings.excluded, selected.id])] : settings.excluded.filter((id) => id !== selected.id); const next = { ...settings, excluded }; setSettings(next); await saveItemSettings(next); }}/><span>Exclude from collection targets</span></label><label className="field-label">Protect owned copies<input type="number" min="0" max={selected.quantity} value={settings.locks[selected.id] ?? selected.invested} onChange={(event) => { const next = { ...settings, locks: { ...settings.locks, [selected.id]: Math.min(selected.quantity, Math.max(0, Number(event.target.value))) } }; setSettings(next); }} onBlur={() => void saveItemSettings(settings)}/></label></div><div className="detail-section"><h3>Crafting allocation</h3>{plan.recipeAllocations.filter((allocation) => allocation.itemId === selected.id).length ? plan.recipeAllocations.filter((allocation) => allocation.itemId === selected.id).map((allocation, index) => <div className="allocation" key={index}><span>{allocation.quantity} × {allocation.itemName}</span><strong>{allocation.destination}</strong><small>{allocation.chain.join(" → ")}</small></div>) : <p>This item has no direct allocation in the current collection plan.</p>}</div><div className="drawer-footer"><span>Collection reserves update automatically from the current snapshot.</span></div></aside></div>}
  </div>;
}

function slug(value: string) { return value.toLowerCase().replaceAll(" ", "-"); }
function explanation(item: PlannedItem) {
  if (item.reserved) return `${item.reserved} ${item.reserved === 1 ? "copy is" : "copies are"} reserved for your collection, crafting recipes, or an investment lock.`;
  if (item.recommendation === "Sell for platinum") return `This is surplus, and its current seller ask meets the configured platinum threshold.`;
  if (item.recommendation === "Ducats") return "This is surplus with a known ducat value and no higher-priority collection use.";
  if (item.recommendation === "Check") return "Sortframe could not confirm a recipe or current price for this item. Keep it until reviewed.";
  return "This item is part of the collection target.";
}

createRoot(document.getElementById("root")!).render(<React.StrictMode><App/></React.StrictMode>);
