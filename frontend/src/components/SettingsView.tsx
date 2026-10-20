// Chatita Mail — Settings: mailbox management (connect / test / sync / recolor / disable / remove) + install app.
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import { CheckCircle2, AlertTriangle, Clock, Plus, RefreshCw, Trash2, PlugZap, Power, Star, Download, KeyRound } from "lucide-react";
import {
  authorizeAccount, createAccount, deleteAccount, listAccounts, patchAccount,
  setAccountPassword, syncAccount, testAccount, type NewAccount,
} from "../api/client";
import { providerLabel } from "./AccountSwitcher";
import { relativeDate } from "../lib/format";
import type { Account } from "../types";

const PALETTE = ["#6366F1", "#10B981", "#F59E0B", "#EF4444", "#06B6D4", "#8B5CF6", "#EC4899", "#84CC16", "#0EA5E9", "#64748B"];

const STATUS: Record<Account["status"], { label: string; cls: string; Icon: typeof Clock }> = {
  connected: { label: "Conectada", cls: "bg-emerald-50 text-emerald-700 border-emerald-200", Icon: CheckCircle2 },
  pending_auth: { label: "Falta autorizar", cls: "bg-amber-50 text-amber-700 border-amber-200", Icon: Clock },
  error: { label: "Error", cls: "bg-red-50 text-red-700 border-red-200", Icon: AlertTriangle },
  disabled: { label: "Desactivada", cls: "bg-slate-100 text-slate-500 border-slate-200", Icon: Power },
};

function errMsg(e: unknown): string {
  const r = (e as { response?: { data?: { detail?: string } } }).response?.data?.detail;
  return r || (e as Error).message;
}

function AccountCard({ a }: { a: Account }) {
  const qc = useQueryClient();
  const refresh = () => qc.invalidateQueries({ queryKey: ["accounts"] });
  const [name, setName] = useState(a.display_name ?? "");
  const [pw, setPw] = useState("");
  const st = STATUS[a.status];
  const needsPassword = (a.provider === "imap" || a.provider === "icloud") && a.status === "pending_auth";

  const connect = useMutation({
    mutationFn: () => authorizeAccount(a.id),
    onSuccess: (r) => { window.location.href = r.url; },
    onError: (e) => toast.error(errMsg(e)),
  });
  const test = useMutation({
    mutationFn: () => testAccount(a.id),
    onSuccess: (r) => { r.ok ? toast.success("Conexión correcta") : toast.error(r.error || "Fallo la prueba"); refresh(); },
    onError: (e) => toast.error(errMsg(e)),
  });
  const sync = useMutation({
    mutationFn: () => syncAccount(a.id),
    onSuccess: (r) => { r.error ? toast.error(r.error) : toast.success(`Sincronizada: ${r.created ?? 0} nuevos`); refresh(); qc.invalidateQueries({ queryKey: ["emails"] }); },
    onError: (e) => toast.error(errMsg(e)),
  });
  const patch = useMutation({ mutationFn: (b: Parameters<typeof patchAccount>[1]) => patchAccount(a.id, b), onSuccess: refresh, onError: (e) => toast.error(errMsg(e)) });
  const pass = useMutation({
    mutationFn: () => setAccountPassword(a.id, pw),
    onSuccess: () => { setPw(""); toast.success("Contraseña guardada (cifrada)"); refresh(); },
    onError: (e) => toast.error(errMsg(e)),
  });
  const del = useMutation({
    mutationFn: (purge: boolean) => deleteAccount(a.id, purge),
    onSuccess: () => { toast.success("Cuenta dada de baja"); refresh(); qc.invalidateQueries(); },
    onError: (e) => toast.error(errMsg(e)),
  });

  const remove = () => {
    if (!window.confirm(`¿Dar de baja ${a.email_address}?\n\nSe detiene la sincronización y se borran sus credenciales.`)) return;
    const purge = window.confirm(`¿Borrar también los ${a.email_count} correos guardados de esta cuenta en Chatita Mail?\n\nAceptar = borrar correos. Cancelar = conservarlos.`);
    del.mutate(purge);
  };

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4" style={{ borderLeft: `4px solid ${a.color ?? "#94a3b8"}` }} data-testid="account-card">
      <div className="flex flex-wrap items-center gap-2">
        <div className="min-w-0 flex-1">
          <div className="font-semibold text-slate-800 truncate">
            {a.display_name || a.email_address} {a.is_default && <Star size={13} className="inline text-amber-500 -mt-0.5" />}
          </div>
          <div className="text-xs text-slate-500 truncate">{a.email_address} · {providerLabel[a.provider]}</div>
        </div>
        <span className={`inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full border ${st.cls}`}>
          <st.Icon size={12} /> {st.label}
        </span>
      </div>

      <div className="mt-2 text-xs text-slate-500 flex flex-wrap gap-x-4 gap-y-0.5">
        <span>{a.email_count.toLocaleString()} correos</span>
        <span>{a.unread_count.toLocaleString()} sin leer</span>
        <span>Última sincronización: {a.last_sync_at ? relativeDate(a.last_sync_at) : "nunca"}</span>
      </div>
      {a.last_error && <div className="mt-2 text-xs text-red-600 bg-red-50 rounded-md p-2 break-words">{a.last_error}</div>}
      {!a.oauth_ready && a.status === "pending_auth" && (a.provider === "microsoft" || a.provider === "gmail") && (
        <div className="mt-2 text-xs text-amber-700 bg-amber-50 rounded-md p-2">
          Falta configurar en el servidor el cliente OAuth de {providerLabel[a.provider]}; sin él no se puede autorizar esta cuenta.
        </div>
      )}

      {needsPassword && (
        <div className="mt-3 flex flex-wrap gap-2">
          <input type="password" value={pw} onChange={(e) => setPw(e.target.value)} placeholder="Contraseña / contraseña de aplicación"
            autoComplete="new-password" className="flex-1 min-w-[200px] rounded-md border border-slate-200 px-2.5 py-1.5 text-sm" />
          <button disabled={!pw || pass.isPending} onClick={() => pass.mutate()}
            className="inline-flex items-center gap-1.5 rounded-md bg-slate-900 text-white text-sm px-3 py-1.5 disabled:opacity-50">
            <KeyRound size={14} /> Guardar
          </button>
        </div>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {(a.provider === "gmail" || a.provider === "microsoft") && a.auth_type !== null && (
          <button onClick={() => connect.mutate()} disabled={connect.isPending}
            className="inline-flex items-center gap-1.5 rounded-md bg-indigo-600 text-white text-sm px-3 py-1.5 hover:bg-indigo-500 disabled:opacity-50">
            <PlugZap size={14} /> {a.status === "connected" ? "Reautorizar" : "Conectar"}
          </button>
        )}
        <button onClick={() => test.mutate()} disabled={test.isPending || a.status === "pending_auth"} className="text-sm rounded-md border border-slate-200 px-3 py-1.5 hover:bg-slate-50 disabled:opacity-50">Probar</button>
        <button onClick={() => sync.mutate()} disabled={sync.isPending || a.status !== "connected"} className="inline-flex items-center gap-1.5 text-sm rounded-md border border-slate-200 px-3 py-1.5 hover:bg-slate-50 disabled:opacity-50">
          <RefreshCw size={13} className={sync.isPending ? "animate-spin" : ""} /> Sincronizar
        </button>
        {!a.is_default && <button onClick={() => patch.mutate({ is_default: true })} className="text-sm rounded-md border border-slate-200 px-3 py-1.5 hover:bg-slate-50">Predeterminada</button>}
        <button onClick={() => patch.mutate({ is_active: !a.is_active })} className="text-sm rounded-md border border-slate-200 px-3 py-1.5 hover:bg-slate-50">{a.is_active ? "Desactivar" : "Activar"}</button>
        <button onClick={remove} className="ml-auto inline-flex items-center gap-1.5 text-sm rounded-md border border-red-200 text-red-600 px-3 py-1.5 hover:bg-red-50"><Trash2 size={13} /> Dar de baja</button>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <input value={name} onChange={(e) => setName(e.target.value)} onBlur={() => name !== (a.display_name ?? "") && patch.mutate({ display_name: name })}
          placeholder="Nombre visible" className="w-48 rounded-md border border-slate-200 px-2 py-1 text-sm" />
        <div className="flex gap-1.5">
          {PALETTE.map((c) => (
            <button key={c} onClick={() => patch.mutate({ color: c })} title={c} aria-label={`Color ${c}`}
              className={`h-5 w-5 rounded-full ${a.color === c ? "ring-2 ring-offset-1 ring-slate-700" : ""}`} style={{ background: c }} />
          ))}
        </div>
      </div>
    </div>
  );
}

function AddAccount() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [f, setF] = useState<NewAccount>({ email_address: "", provider: "gmail" });
  const create = useMutation({
    mutationFn: () => createAccount(f),
    onSuccess: () => { toast.success("Cuenta agregada"); setOpen(false); setF({ email_address: "", provider: "gmail" }); qc.invalidateQueries({ queryKey: ["accounts"] }); },
    onError: (e) => toast.error(errMsg(e)),
  });
  const usesPassword = f.provider === "imap" || f.provider === "icloud";
  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 text-white text-sm font-semibold px-4 py-2 hover:bg-indigo-500">
        <Plus size={16} /> Agregar cuenta
      </button>
    );
  }
  return (
    <div className="rounded-xl border border-indigo-200 bg-indigo-50/40 p-4 space-y-3" data-testid="add-account">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        {(["gmail", "microsoft", "imap", "icloud"] as const).map((p) => (
          <button key={p} onClick={() => setF({ ...f, provider: p, imap_preset: p === "imap" ? "workmail" : undefined })}
            className={`rounded-lg border px-3 py-2 text-sm ${f.provider === p ? "border-indigo-500 bg-white font-semibold" : "border-slate-200 bg-white/60"}`}>
            {providerLabel[p]}
          </button>
        ))}
      </div>
      <input value={f.email_address} onChange={(e) => setF({ ...f, email_address: e.target.value.trim() })} type="email" inputMode="email"
        placeholder="correo@dominio.com" className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm" />
      <input value={f.display_name ?? ""} onChange={(e) => setF({ ...f, display_name: e.target.value })} placeholder="Nombre visible (opcional)"
        className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm" />
      {f.provider === "imap" && (
        <div className="grid sm:grid-cols-3 gap-2">
          <select value={f.imap_preset ?? "workmail"} onChange={(e) => setF({ ...f, imap_preset: e.target.value })} className="rounded-md border border-slate-200 px-2 py-2 text-sm">
            <option value="workmail">Amazon WorkMail (us-east-1)</option>
            <option value="outlook_imap">Exchange / Outlook IMAP</option>
            <option value="">Personalizado</option>
          </select>
          {!f.imap_preset && (
            <>
              <input placeholder="Servidor IMAP" onChange={(e) => setF({ ...f, imap_host: e.target.value })} className="rounded-md border border-slate-200 px-2 py-2 text-sm" />
              <input placeholder="Servidor SMTP" onChange={(e) => setF({ ...f, smtp_host: e.target.value })} className="rounded-md border border-slate-200 px-2 py-2 text-sm" />
            </>
          )}
        </div>
      )}
      {usesPassword && (
        <input type="password" autoComplete="new-password" placeholder="Contraseña (o contraseña de aplicación)"
          onChange={(e) => setF({ ...f, password: e.target.value })} className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm" />
      )}
      <p className="text-xs text-slate-500">
        {usesPassword
          ? "La contraseña se cifra en el servidor y nunca vuelve al navegador."
          : "Después de agregarla, usa «Conectar» para iniciar sesión en el proveedor y autorizar el acceso."}
      </p>
      <div className="flex gap-2">
        <button disabled={!f.email_address.includes("@") || create.isPending} onClick={() => create.mutate()} className="rounded-md bg-slate-900 text-white text-sm px-4 py-2 disabled:opacity-50">Agregar</button>
        <button onClick={() => setOpen(false)} className="rounded-md border border-slate-200 bg-white text-sm px-4 py-2">Cancelar</button>
      </div>
    </div>
  );
}

function InstallApp() {
  const [evt, setEvt] = useState<(Event & { prompt: () => Promise<void> }) | null>(null);
  const standalone = window.matchMedia("(display-mode: standalone)").matches;
  useEffect(() => {
    const h = (e: Event) => { e.preventDefault(); setEvt(e as never); };
    window.addEventListener("beforeinstallprompt", h);
    return () => window.removeEventListener("beforeinstallprompt", h);
  }, []);
  const ios = /iphone|ipad/i.test(navigator.userAgent);
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4">
      <h3 className="font-semibold text-slate-800 mb-1">Instalar en el teléfono</h3>
      {standalone ? <p className="text-sm text-emerald-700">Ya estás usando la app instalada.</p> : evt ? (
        <button onClick={() => evt.prompt()} className="inline-flex items-center gap-1.5 rounded-md bg-slate-900 text-white text-sm px-4 py-2"><Download size={14} /> Instalar Chatita Mail</button>
      ) : (
        <p className="text-sm text-slate-500">{ios ? "En Safari: Compartir → «Agregar a pantalla de inicio»." : "En el menú del navegador elige «Instalar app» / «Agregar a pantalla de inicio»."}</p>
      )}
    </section>
  );
}

export default function SettingsView() {
  const { data: accounts = [], isLoading } = useQuery({ queryKey: ["accounts"], queryFn: listAccounts });
  const qc = useQueryClient();
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    if (q.get("connected")) toast.success(`Cuenta conectada: ${q.get("connected")}`);
    if (q.get("error")) toast.error(`No se pudo conectar: ${q.get("error")}`);
    if (q.get("connected") || q.get("error")) { window.history.replaceState({}, "", window.location.pathname); qc.invalidateQueries({ queryKey: ["accounts"] }); }
  }, [qc]);

  return (
    <div className="flex-1 overflow-y-auto bg-slate-50 p-4 md:p-6" data-testid="settings-view">
      <div className="max-w-3xl mx-auto space-y-5">
        <header>
          <h2 className="text-xl font-bold text-slate-800">Configuración</h2>
          <p className="text-sm text-slate-500">Cuentas de correo conectadas a Chatita Mail. Cada una tiene su color; en «Todas las bandejas» se combinan.</p>
        </header>
        <section className="space-y-3">
          <div className="flex items-center"><h3 className="font-semibold text-slate-800">Cuentas ({accounts.length})</h3></div>
          {isLoading && <div className="text-sm text-slate-400">Cargando…</div>}
          {accounts.map((a) => <AccountCard key={a.id} a={a} />)}
          <AddAccount />
        </section>
        <InstallApp />
      </div>
    </div>
  );
}
