// Chatita Mail — account switcher: unified inbox + one entry per mailbox (color, unread, sync state).
import { useQuery } from "@tanstack/react-query";
import { Layers, AlertTriangle, Settings } from "lucide-react";
import { listAccounts } from "../api/client";
import { useUI } from "../store";
import type { Account } from "../types";

export const providerLabel: Record<Account["provider"], string> = {
  gmail: "Google",
  microsoft: "Microsoft 365",
  imap: "IMAP",
  icloud: "iCloud",
};

export default function AccountSwitcher() {
  const { accountId, setAccount, setFolder } = useUI();
  const { data: accounts = [] } = useQuery({ queryKey: ["accounts"], queryFn: listAccounts, refetchInterval: 30000 });
  const usable = accounts.filter((a) => a.is_active);
  const totalUnread = usable.reduce((n, a) => n + a.unread_count, 0);

  const pick = (id: string) => {
    setAccount(id);
    setFolder("inbox");
  };

  return (
    <div className="px-2 space-y-0.5" data-testid="account-switcher">
      <div className="px-2 mb-1 flex items-center text-[10px] font-semibold uppercase tracking-wider text-slate-400">
        Cuentas
        <button
          onClick={() => setFolder("settings")}
          title="Configurar cuentas"
          className="ml-auto text-slate-400 hover:text-slate-700"
        >
          <Settings size={12} />
        </button>
      </div>
      <button
        onClick={() => pick("all")}
        className={`w-full flex items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-sm ${
          accountId === "all" ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-200/60"
        }`}
      >
        <Layers size={16} />
        <span className="flex-1 text-left">Todas las bandejas</span>
        {totalUnread > 0 && <span className="text-[11px] opacity-70">{totalUnread}</span>}
      </button>
      {usable.map((a) => (
        <button
          key={a.id}
          onClick={() => pick(a.id)}
          title={`${a.email_address} · ${providerLabel[a.provider]}`}
          className={`w-full flex items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-sm ${
            accountId === a.id ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-200/60"
          }`}
        >
          <span className="h-2.5 w-2.5 rounded-full shrink-0" style={{ background: a.color ?? "#94a3b8" }} />
          <span className="flex-1 text-left truncate">{a.display_name || a.email_address}</span>
          {a.status !== "connected" ? (
            <AlertTriangle size={13} className={a.status === "error" ? "text-red-500" : "text-amber-500"} />
          ) : (
            a.unread_count > 0 && <span className="text-[11px] opacity-70">{a.unread_count}</span>
          )}
        </button>
      ))}
    </div>
  );
}
