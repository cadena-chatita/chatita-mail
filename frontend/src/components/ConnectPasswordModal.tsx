// Chatita Mail — "connect with password" dialog (Apple-Mail-style): detect server, test, retry, manual server.
import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import { AlertTriangle, CheckCircle2, Eye, EyeOff, Loader2, Search, Server, X } from "lucide-react";
import { authorizeAccount, connectPassword, discoverAccount, type ConnectResult } from "../api/client";
import type { Account } from "../types";

const PROVIDER_NAME: Record<string, string> = {
  microsoft365: "Microsoft 365 / Exchange Online",
  google: "Google Workspace / Gmail",
  godaddy: "GoDaddy Workspace Email",
  workmail: "Amazon WorkMail",
  icloud: "iCloud",
  titan: "Titan Email",
  unknown: "Servidor no identificado",
};

const HELP: Record<string, string> = {
  bad_credentials: "El servidor rechazó el usuario o la contraseña. Escribe la contraseña de nuevo: es la del buzón (en GoDaddy no es la contraseña de tu cuenta GoDaddy).",
  login_disabled: "Microsoft 365 no permite contraseña por IMAP. Apple Mail y Outlook inician sesión en una ventana de Microsoft; aquí se hace igual con «Conectar con Microsoft».",
  dns_error: "Ese nombre de servidor no existe. Revísalo o usa «Buscar servidor».",
  timeout: "El servidor no respondió. Verifica el servidor y el puerto (IMAP normalmente 993).",
  connect_error: "El servidor rechazó la conexión en ese puerto.",
  tls_error: "Falló el cifrado TLS: revisa el puerto (993 con SSL/TLS).",
  no_server: "No encontré el servidor de este dominio. Escríbelo a mano.",
};

export default function ConnectPasswordModal({ account, onClose }: { account: Account; onClose: () => void }) {
  const qc = useQueryClient();
  const pwRef = useRef<HTMLInputElement>(null);
  const [pw, setPw] = useState("");
  const [show, setShow] = useState(false);
  const [manual, setManual] = useState(false);
  const [m, setM] = useState({ username: account.email_address, imap_host: "", imap_port: "993", smtp_host: "", smtp_port: "465" });
  const [result, setResult] = useState<ConnectResult | null>(null);

  const det = useQuery({ queryKey: ["discover", account.email_address], queryFn: () => discoverAccount(account.email_address), staleTime: 60_000 });
  useEffect(() => {
    if (det.data && !m.imap_host) setM((v) => ({ ...v, imap_host: det.data!.imap_host ?? "", imap_port: String(det.data!.imap_port ?? 993), smtp_host: det.data!.smtp_host ?? "", smtp_port: String(det.data!.smtp_port ?? 465) }));
  }, [det.data]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { pwRef.current?.focus(); }, []);

  const connect = useMutation({
    mutationFn: () =>
      connectPassword(account.id, {
        password: pw,
        ...(manual ? { username: m.username, imap_host: m.imap_host, imap_port: Number(m.imap_port), smtp_host: m.smtp_host || undefined, smtp_port: Number(m.smtp_port) } : {}),
      }),
    onSuccess: (r) => {
      setResult(r);
      if (r.ok) { toast.success(r.message); qc.invalidateQueries({ queryKey: ["accounts"] }); setTimeout(onClose, 900); }
      else { setPw(""); pwRef.current?.focus(); }
    },
    onError: (e) => toast.error((e as Error).message),
  });
  const oauth = useMutation({
    mutationFn: () => authorizeAccount(account.id),
    onSuccess: (r) => { window.location.href = r.url; },
    onError: (e) => toast.error((e as { response?: { data?: { detail?: string } } }).response?.data?.detail || (e as Error).message),
  });

  const d = det.data;
  const isM365 = d?.method === "oauth_microsoft";
  const failed = result && !result.ok;

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-slate-900/50 p-0 sm:p-4" role="dialog" aria-modal="true" aria-label={`Conectar ${account.email_address}`}>
      <div className="w-full h-full sm:h-auto sm:max-w-lg sm:rounded-2xl bg-white shadow-2xl flex flex-col sm:max-h-[92vh] pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)]">
        <div className="flex items-center gap-2 px-5 py-4 border-b border-slate-100">
          <span className="h-3 w-3 rounded-full" style={{ background: account.color ?? "#94a3b8" }} />
          <div className="min-w-0 flex-1">
            <div className="font-semibold text-slate-800 truncate">Conectar {account.display_name || account.email_address}</div>
            <div className="text-xs text-slate-500 truncate">{account.email_address}</div>
          </div>
          <button onClick={onClose} aria-label="Cerrar" className="text-slate-400 hover:text-slate-600"><X size={18} /></button>
        </div>

        <div className="p-5 space-y-4 overflow-y-auto">
          {/* Detection */}
          <div className="rounded-lg bg-slate-50 border border-slate-200 p-3 text-sm">
            {det.isLoading ? (
              <span className="inline-flex items-center gap-2 text-slate-500"><Loader2 size={14} className="animate-spin" /> Buscando el servidor de {account.email_address.split("@")[1]}…</span>
            ) : d ? (
              <div>
                <div className="font-medium text-slate-800 inline-flex items-center gap-1.5"><Search size={14} /> {PROVIDER_NAME[d.provider]}</div>
                {d.imap_host && <div className="text-xs text-slate-500 mt-0.5"><Server size={12} className="inline -mt-0.5" /> {d.imap_host}:{d.imap_port}</div>}
                <ul className="mt-1 text-[11px] text-slate-400 list-disc ml-4">{d.evidence.map((e) => <li key={e}>{e}</li>)}</ul>
              </div>
            ) : <span className="text-slate-500">No se pudo consultar el DNS.</span>}
          </div>

          {isM365 && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900 space-y-2">
              <p><b>Microsoft 365 no acepta contraseña por IMAP</b> (el servidor responde <code>LOGINDISABLED</code>; GoDaddy y Microsoft lo confirman). Apple Mail se conecta con una ventana de inicio de sesión de Microsoft, donde tú escribes la contraseña.</p>
              <button onClick={() => oauth.mutate()} disabled={oauth.isPending} className="rounded-md bg-[#0F6CBD] text-white text-sm font-semibold px-4 py-2 disabled:opacity-60">
                {oauth.isPending ? "Abriendo…" : "Conectar con Microsoft"}
              </button>
              {!account.oauth_ready && <p className="text-xs">Falta registrar la app de Microsoft en el servidor (una sola vez, gratis, ~5 min: ver «Conectar cuentas Microsoft 365» al final de Configuración). Sin ella este botón no puede abrir el inicio de sesión.</p>}
            </div>
          )}

          {/* Password */}
          <div>
            <label htmlFor="pw" className="block text-xs font-medium text-slate-600 mb-1">Contraseña del buzón</label>
            <div className="flex gap-2">
              <input id="pw" ref={pwRef} type={show ? "text" : "password"} value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="new-password"
                onKeyDown={(e) => e.key === "Enter" && pw && !connect.isPending && connect.mutate()}
                className="flex-1 rounded-md border border-slate-300 px-3 py-2 text-sm" placeholder="Contraseña" />
              <button onClick={() => setShow(!show)} aria-label="Mostrar u ocultar" className="rounded-md border border-slate-200 px-2.5 text-slate-500">{show ? <EyeOff size={16} /> : <Eye size={16} />}</button>
            </div>
            <p className="text-[11px] text-slate-400 mt-1">Se prueba contra el servidor y solo se guarda, cifrada, si la conexión es correcta.</p>
          </div>

          {/* Result */}
          {connect.isPending && <div className="inline-flex items-center gap-2 text-sm text-slate-600"><Loader2 size={15} className="animate-spin" /> Conectando con {d?.imap_host ?? "el servidor"}…</div>}
          {result?.ok && (
            <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800 inline-flex items-start gap-2"><CheckCircle2 size={16} className="mt-0.5" /> {result.message}</div>
          )}
          {failed && (
            <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800 space-y-1" role="alert">
              <div className="inline-flex items-center gap-2 font-medium"><AlertTriangle size={15} /> No se pudo conectar</div>
              <p>{HELP[result.code] ?? result.message}</p>
              <p className="text-xs text-red-600/80">Servidor probado: {result.tried.imap_host}:{result.tried.imap_port} · usuario {result.tried.username}{result.imap?.message && result.imap.message !== HELP[result.code] ? ` · ${result.imap.message}` : ""}</p>
            </div>
          )}

          {/* Manual server */}
          <div>
            <button onClick={() => setManual(!manual)} className="text-xs font-medium text-indigo-600 hover:underline">{manual ? "Ocultar servidor manual" : "Configurar servidor manualmente"}</button>
            {manual && (
              <div className="mt-2 grid grid-cols-6 gap-2 text-sm">
                <input className="col-span-6 rounded-md border border-slate-300 px-2.5 py-1.5" placeholder="Usuario" value={m.username} onChange={(e) => setM({ ...m, username: e.target.value })} />
                <input className="col-span-4 rounded-md border border-slate-300 px-2.5 py-1.5" placeholder="Servidor IMAP" value={m.imap_host} onChange={(e) => setM({ ...m, imap_host: e.target.value.trim() })} />
                <input className="col-span-2 rounded-md border border-slate-300 px-2.5 py-1.5" placeholder="Puerto" inputMode="numeric" value={m.imap_port} onChange={(e) => setM({ ...m, imap_port: e.target.value })} />
                <input className="col-span-4 rounded-md border border-slate-300 px-2.5 py-1.5" placeholder="Servidor SMTP" value={m.smtp_host} onChange={(e) => setM({ ...m, smtp_host: e.target.value.trim() })} />
                <input className="col-span-2 rounded-md border border-slate-300 px-2.5 py-1.5" placeholder="Puerto" inputMode="numeric" value={m.smtp_port} onChange={(e) => setM({ ...m, smtp_port: e.target.value })} />
                <button onClick={() => det.refetch()} className="col-span-6 text-xs text-slate-500 text-left hover:underline">↻ Buscar servidor automáticamente de nuevo</button>
              </div>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2 px-5 py-4 border-t border-slate-100">
          <button onClick={() => connect.mutate()} disabled={!pw || connect.isPending} className="rounded-md bg-slate-900 text-white text-sm font-medium px-5 py-2 disabled:opacity-50">
            {failed ? "Probar de nuevo" : "Conectar"}
          </button>
          <button onClick={onClose} className="rounded-md border border-slate-200 text-sm px-4 py-2 text-slate-600">Cerrar</button>
        </div>
      </div>
    </div>
  );
}
