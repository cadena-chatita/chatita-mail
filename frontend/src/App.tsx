// Chatita Mail v3.0 — application shell (3-pane: Sidebar | List | Reading)
import { Search, Filter, Sparkles, Menu, ArrowLeft, PenSquare, Inbox, Settings as SettingsIcon, Layers, X, CheckSquare } from "lucide-react";
import Sidebar from "./components/Sidebar";
import EmailList from "./components/EmailList";
import ReadingPane from "./components/ReadingPane";
import TasksView from "./components/TasksView";
import Dashboard from "./components/Dashboard";
import AgentView, { type AgentMode } from "./components/AgentView";
import ComposeModal from "./components/ComposeModal";
import AccessibilityMenu from "./components/AccessibilityMenu";
import { useEffect } from "react";
import SettingsView from "./components/SettingsView";
import { folderFromHash, useUI } from "./store";
import NewVersionBanner from "./components/NewVersionBanner";

export default function App() {
  const { folderKey, search, setSearch, searchMode, setSearchMode, unreadOnly, toggleUnreadOnly, selectedEmailId, selectEmail, setDrawer, openCompose, setFolder } =
    useUI();
  const isSettings = folderKey === "settings";
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    if (q.get("compose") === "1") openCompose();
    if (q.get("settings")) setFolder("settings");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {      // deep links from Chatita Workspace: /mail/#agent_calendar
    const h = () => { const k = folderFromHash(); if (k && k !== useUI.getState().folderKey) setFolder(k); };
    window.addEventListener("hashchange", h);
    return () => window.removeEventListener("hashchange", h);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => { if (location.hash !== `#${folderKey}`) history.replaceState(null, "", `#${folderKey}`); }, [folderKey]);
  const isWorkflow = folderKey === "tasks" || folderKey === "commitments";
  const isAgent = folderKey.startsWith("agent_");
  const overlayOpen = (isWorkflow || isAgent) && !!selectedEmailId;
  useEffect(() => {
    if (!overlayOpen) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && selectEmail(null);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [overlayOpen, selectEmail]);
  const isDashboard = folderKey === "dashboard";
  const meaning = searchMode === "meaning";

  return (
    <div className="h-[100dvh] flex bg-slate-100 text-slate-900 overflow-hidden">
      <ComposeModal />
      <NewVersionBanner />
      <Sidebar />

      <div className="flex-1 flex flex-col min-w-0">
        {/* Top bar */}
        <header className="min-h-14 shrink-0 border-b border-slate-200 bg-white px-3 md:px-4 pt-[env(safe-area-inset-top)] flex items-center gap-2 md:gap-3">
          <button onClick={() => (selectedEmailId ? selectEmail(null) : setDrawer(true))} className="md:hidden p-2 -ml-1 text-slate-600" aria-label="Menu">
            {selectedEmailId ? <ArrowLeft size={20} /> : <Menu size={20} />}
          </button>
          <div className="relative flex-1 max-w-xl">
            {meaning ? (
              <Sparkles
                size={16}
                className="absolute left-3 top-1/2 -translate-y-1/2 text-indigo-500"
              />
            ) : (
              <Search
                size={16}
                className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
              />
            )}
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={
                meaning
                  ? "Buscar por significado… (ej. 'facturas pendientes de pago')"
                  : "Buscar remitente, asunto, contenido…"
              }
              className={`w-full rounded-lg border bg-slate-50 pl-9 pr-3 py-2 text-sm focus:outline-none focus:ring-2 ${
                meaning
                  ? "border-indigo-300 focus:ring-indigo-300"
                  : "border-slate-200 focus:ring-slate-300"
              }`}
            />
          </div>

          {/* Text vs semantic (meaning) search toggle */}
          <div className="hidden sm:flex rounded-lg border border-slate-200 overflow-hidden text-xs">
            <button
              onClick={() => setSearchMode("text")}
              className={`px-2.5 py-2 transition ${
                !meaning ? "bg-slate-900 text-white" : "text-slate-500 hover:bg-slate-50"
              }`}
            >
              Texto
            </button>
            <button
              onClick={() => setSearchMode("meaning")}
              title="Búsqueda semántica por significado (BGE-M3 + pgvector)"
              className={`px-2.5 py-2 inline-flex items-center gap-1 transition ${
                meaning ? "bg-indigo-600 text-white" : "text-slate-500 hover:bg-slate-50"
              }`}
            >
              <Sparkles size={12} /> Significado
            </button>
          </div>

          <button
            onClick={toggleUnreadOnly}
            className={`hidden sm:inline-flex items-center gap-1.5 rounded-lg border px-3 py-2 text-sm transition ${
              unreadOnly
                ? "border-slate-900 bg-slate-900 text-white"
                : "border-slate-200 text-slate-600 hover:bg-slate-50"
            }`}
          >
            <Filter size={14} />
            No leídos
          </button>

          <AccessibilityMenu />

          <span className="text-xs text-slate-400 hidden md:block">
            ≤5 min/day · AION Brain
          </span>
        </header>

        {/* Panes */}
        <div className="flex-1 flex overflow-hidden">
          {isSettings ? (
            <SettingsView />
          ) : isDashboard ? (
            <Dashboard />
          ) : isWorkflow || isAgent ? (
            <>
              {isWorkflow ? <TasksView mode={folderKey as "tasks" | "commitments"} /> : <AgentView mode={folderKey.replace("agent_", "") as AgentMode} />}
              {selectedEmailId && (
                <div className="fixed inset-0 z-40 flex justify-end bg-slate-900/40" onClick={() => selectEmail(null)}>
                  <div
                    className="flex h-full w-full min-w-0 flex-col bg-white shadow-2xl md:w-[780px]"
                    onClick={(e) => e.stopPropagation()}
                    role="dialog"
                    aria-label="Correo de origen"
                  >
                    <div className="flex items-center justify-between border-b border-slate-200 px-4 py-2 pt-[max(0.5rem,env(safe-area-inset-top))]">
                      <span className="text-sm text-slate-500">Correo que originó el elemento</span>
                      <button
                        onClick={() => selectEmail(null)}
                        aria-label="Cerrar correo"
                        className="inline-flex items-center gap-1 rounded-md border border-slate-200 px-2.5 py-1 text-sm text-slate-700 hover:bg-slate-100"
                      >
                        <X size={14} /> Cerrar
                      </button>
                    </div>
                    <ReadingPane />
                  </div>
                </div>
              )}
            </>
          ) : (
            <>
              <EmailList />
              <div className={`${selectedEmailId ? "flex" : "hidden md:flex"} flex-1 min-w-0 min-h-0`}>
                <ReadingPane />
              </div>
            </>
          )}
        </div>

        {/* Mobile bottom navigation */}
        <nav className="md:hidden shrink-0 border-t border-slate-200 bg-white grid grid-cols-6 pb-[env(safe-area-inset-bottom)]">
          {[
            { k: "inbox", label: "Bandeja", I: Inbox },
            { k: "critical", label: "Críticos", I: Layers },
            { k: "agent_today", label: "Hoy", I: Sparkles },
            { k: "tasks", label: "Tareas", I: CheckSquare },
            { k: "settings", label: "Cuentas", I: SettingsIcon },
          ].map(({ k, label, I }) => (
            <button key={k} onClick={() => setFolder(k)} className={`flex flex-col items-center py-2 text-[11px] ${folderKey === k ? "text-indigo-600" : "text-slate-500"}`}>
              <I size={20} />
              {label}
            </button>
          ))}
          <button onClick={openCompose} className="flex flex-col items-center py-2 text-[11px] text-slate-500">
            <PenSquare size={20} />
            Redactar
          </button>
        </nav>
      </div>
    </div>
  );
}
