// A tab left open for days keeps running the old build. This notices a newer deploy and offers a reload.
import { useEffect, useState } from "react";

const assetsOf = (html: string) => (html.match(/assets\/index-[A-Za-z0-9_-]+\.(?:js|css)/g) ?? []).sort().join(",");

export default function NewVersionBanner() {
  const [stale, setStale] = useState(false);
  useEffect(() => {
    const mine = [...document.querySelectorAll('script[src*="/assets/index-"], link[href*="/assets/index-"]')].map((e) => (e.getAttribute("src") ?? e.getAttribute("href") ?? "").replace(/^.*?(assets\/)/, "$1")).sort().join(",");
    if (!mine) return;
    const check = async () => {
      try {
        const r = await fetch(`${import.meta.env.BASE_URL}index.html?_=${Date.now()}`, { cache: "no-store" });
        const live = r.ok ? assetsOf(await r.text()) : "";
        if (live && live !== mine) setStale(true);
      } catch { /* offline: nothing to say */ }
    };
    const t = setInterval(check, 120_000);
    const onVis = () => document.visibilityState === "visible" && check();
    document.addEventListener("visibilitychange", onVis);
    return () => { clearInterval(t); document.removeEventListener("visibilitychange", onVis); };
  }, []);
  if (!stale) return null;
  return (
    <div role="status" className="fixed inset-x-0 top-0 z-[70] flex items-center justify-center gap-3 bg-indigo-600 px-3 py-2 text-sm text-white" data-testid="new-version">
      Hay una versión nueva de Chatita Mail.
      <button onClick={() => location.reload()} className="rounded bg-white px-2.5 py-0.5 font-medium text-indigo-700">Actualizar</button>
    </div>
  );
}
