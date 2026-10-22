// Chatita Mail v3.0 — left navigation (folders, counts, sync, workload)
import { useEffect, useRef } from "react";
import * as Icons from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import { getStats, syncGmail } from "../api/client";
import { FOLDERS, useUI, type FolderDef } from "../store";
import { humanMinutes } from "../lib/format";
import AccountSwitcher from "./AccountSwitcher";
import type { InboxStats } from "../types";

function LucideIcon({ name, className }: { name: string; className?: string }) {
  const Cmp = (Icons as unknown as Record<string, React.ComponentType<{ size?: number; className?: string }>>)[name];
  if (!Cmp) return null;
  return <Cmp size={16} className={className} />;
}

function countFor(folder: FolderDef, stats?: InboxStats): number | null {
  if (!stats) return null;
  switch (folder.countSource) {
    case "unread":
      return stats.unread || null;
    case "status":
      return folder.countKey ? stats.by_status[folder.countKey] ?? null : null;
    case "category":
      return folder.countKey ? stats.by_category[folder.countKey] ?? null : null;
    case "tasks":
      return stats.open_tasks || null;
    case "commitments":
      return stats.open_commitments || null;
    default:
      return null;
  }
}

const GROUPS: { id: FolderDef["group"]; label: string | null }[] = [
  { id: "primary", label: null },
  { id: "agent", label: "AION Agent" },
  { id: "workflow", label: "Flujo de trabajo" },
  { id: "categories", label: "Prioridad" },
  { id: "system", label: "Filtrados" },
];

export default function Sidebar() {
  const { folderKey, setFolder, openCompose, accountId, drawerOpen, setDrawer } = useUI();
  const qc = useQueryClient();

  const { data: stats } = useQuery({
    queryKey: ["stats", accountId],
    queryFn: () => getStats(accountId === "all" ? undefined : accountId),
    refetchInterval: 15000,
  });

  const sync = useMutation({
    mutationFn: () => syncGmail(30, true),
    onSuccess: (res) => {
      toast.success(
        `Sincronizado: ${res.pulled ?? res.upserted ?? 0} nuevos · ${res.triaged ?? 0} clasificados`
      );
      qc.invalidateQueries();
    },
    onError: (e: unknown) => toast.error(`Falló la sincronización: ${(e as Error).message}`),
  });

  // Auto-sync on open: fire an incremental sync once when the app mounts
  // (i.e. when the user clicks/opens Mail) so the inbox is fresh immediately.
  // Background systemd timers keep syncing every few minutes thereafter.
  const autoSyncedRef = useRef(false);
  useEffect(() => {
    if (autoSyncedRef.current) return;
    autoSyncedRef.current = true;
    sync.mutate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <>
    {drawerOpen && <div className="fixed inset-0 z-30 bg-slate-900/40 md:hidden" onClick={() => setDrawer(false)} />}
    <aside
      className={`fixed md:static inset-y-0 left-0 z-40 w-72 md:w-60 shrink-0 overflow-y-auto overscroll-contain border-r border-slate-200 bg-slate-50 flex flex-col pt-[env(safe-area-inset-top)] transition-transform md:translate-x-0 ${
        drawerOpen ? "translate-x-0" : "-translate-x-full"
      }`}
    >
      {/* Brand */}
      <div className="px-4 py-3 flex items-center gap-2">
        <div className="h-8 w-8 rounded-lg bg-slate-900 text-white grid place-items-center text-sm">
          📬
        </div>
        <div className="leading-tight">
          <div className="font-bold text-slate-800">Chatita Mail</div>
          <div className="text-[10px] text-slate-400">v3.0 · AION Brain</div>
        </div>
      </div>

      {/* Compose + Sync */}
      <div className="px-3 space-y-2">
        <button
          onClick={openCompose}
          className="w-full flex items-center justify-center gap-2 rounded-lg bg-indigo-600 text-white text-sm font-semibold py-2 hover:bg-indigo-500 transition"
        >
          <LucideIcon name="PenSquare" />
          Redactar
        </button>
        <button
          onClick={() => sync.mutate()}
          disabled={sync.isPending}
          className="w-full flex items-center justify-center gap-2 rounded-lg bg-slate-900 text-white text-sm font-medium py-2 hover:bg-slate-700 transition disabled:opacity-60"
        >
          <LucideIcon name={sync.isPending ? "Loader" : "RefreshCw"} className={sync.isPending ? "animate-spin" : ""} />
          {sync.isPending ? "Sincronizando…" : "Sincronizar"}
        </button>
      </div>

      {/* Folders */}
      <nav className="flex-1 px-2 py-3 space-y-3">
        <AccountSwitcher />
        {GROUPS.map((g) => {
          const items = FOLDERS.filter((f) => f.group === g.id);
          if (items.length === 0) return null;
          return (
            <div key={g.id}>
              {g.label && (
                <div className="px-2 mb-1 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                  {g.label}
                </div>
              )}
              {items.map((f) => {
                const active = folderKey === f.key;
                const cnt = countFor(f, stats);
                return (
                  <button
                    key={f.key}
                    onClick={() => setFolder(f.key)}
                    className={`w-full flex items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-sm transition ${
                      active
                        ? "bg-slate-900 text-white"
                        : "text-slate-600 hover:bg-slate-200/60"
                    }`}
                  >
                    <LucideIcon name={f.icon} className={active ? "text-white" : "text-slate-400"} />
                    <span className="flex-1 text-left">{f.label}</span>
                    {cnt != null && cnt > 0 && (
                      <span
                        className={`text-[11px] rounded-full px-1.5 min-w-[20px] text-center ${
                          active ? "bg-white/20 text-white" : "bg-slate-200 text-slate-600"
                        }`}
                      >
                        {cnt}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          );
        })}
      </nav>

      <button
        onClick={() => setFolder("settings")}
        className={`mx-2 mb-1 flex items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-sm ${
          folderKey === "settings" ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-200/60"
        }`}
      >
        <LucideIcon name="Settings" /> Configuración
      </button>

      {/* Workload footer */}
      <div className="border-t border-slate-200 p-3 text-xs text-slate-500 space-y-1">
        <div className="flex items-center justify-between">
          <span>Tiempo ahorrado</span>
          <span className="font-semibold text-emerald-600">
            {stats ? humanMinutes(stats.time_saved_minutes) : "—"}
          </span>
        </div>
        <div className="flex items-center justify-between">
          <span>Total de correos</span>
          <span className="font-medium text-slate-600">{stats?.total ?? "—"}</span>
        </div>
      </div>
    </aside>
    </>
  );
}
