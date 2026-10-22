// FICTITIOUS data only (this repository is public). Shapes mirror the real API.
import type { Page } from "@playwright/test";

export const ACCOUNT = { id: "acc-1", provider: "gmail", email_address: "demo@example.test", display_name: "Demo", color: "#6366f1", auth_type: "oauth", status: "connected",
  is_active: true, is_default: true, last_sync_at: "2026-10-21T12:00:00Z", last_error: null, email_count: 2, unread_count: 1, oauth_ready: true };

export function emailItem(id: string, subject: string) {
  return { id, account_id: ACCOUNT.id, from_address: "ana@example.test", from_name: "Ana Prueba", subject, snippet: "Resumen corto", status: "INBOX", is_read: false,
    received_at: "2026-10-21T10:00:00Z", thread_id: `t-${id}`, has_html: true, has_attachments: false, category: "IMPORTANT", confidence: 0.9, is_newsletter: false,
    unsubscribe_url: null, risk_level: "safe", risk_score: 0.01 };
}

export function emailDetail(id: string, subject: string, paragraphs = 3) {
  const body = Array.from({ length: paragraphs }, (_, i) => `<p>Párrafo ${i + 1} del correo de prueba ${id}. Lorem ipsum dolor sit amet, consectetur adipiscing elit.</p>`).join("");
  return { id, from_address: "ana@example.test", from_name: "Ana Prueba", to_addresses: ["demo@example.test"], cc_addresses: ["otra@example.test"], subject,
    body_text: "texto", body_html: body, snippet: "Resumen corto", attachments: [], status: "INBOX", is_read: false, thread_id: `t-${id}`, received_at: "2026-10-21T10:00:00Z",
    classification: { category: "IMPORTANT", confidence: 0.9, stage: "llm", reasoning: "demo", is_newsletter: false, unsubscribe_url: null },
    security: { risk_score: 0.01, risk_level: "safe", explanation: "", risk_factors: [], recommended_action: "none" }, tasks: [], commitments: [] };
}

export function task(id: string, emailId: string, description: string, over: Record<string, unknown> = {}) {
  return { id, email_id: emailId, description, task_type: "payment", priority: "high", deadline: "2026-10-23T18:00:00Z", status: "pending",
    created_at: "2026-10-21T10:00:00Z", completed_at: null, closed_via: null, ...over };
}

export interface MockOpts { paragraphs?: number; tasks?: ReturnType<typeof task>[] }

/** Mocks every /api call. Returns the list of calls nobody handled, so tests can fail on surprises. */
export async function mockApi(page: Page, opts: MockOpts = {}) {
  const unhandled: string[] = [];
  const calls: { method: string; path: string; body?: unknown }[] = [];
  const emails = { "e-long": "Propuesta con plazo (correo largo)", "e-two": "Segundo correo" };
  const tasks = opts.tasks ?? [];
  await page.route((url) => url.pathname.startsWith("/api/"), async (route) => {
    const req = route.request();
    const path = new URL(req.url()).pathname.replace(/^\/api/, "");
    const method = req.method();
    const json = (data: unknown, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(data) });
    calls.push({ method, path, body: req.postData() ? JSON.parse(req.postData() as string) : undefined });
    if (method === "GET" && path === "/accounts") return json([ACCOUNT]);
    if (method === "GET" && path === "/inbox/stats") return json({ total: 2, unread: 1, by_status: { INBOX: 2 }, by_category: { IMPORTANT: 2 }, open_tasks: tasks.length, open_commitments: 0, time_saved_minutes: 0 });
    if (method === "GET" && path === "/inbox/emails") return json(Object.entries(emails).map(([id, s]) => emailItem(id, s)));
    const m = path.match(/^\/inbox\/emails\/([^/]+)$/);
    if (method === "GET" && m && (emails as Record<string, string>)[m[1]]) return json(emailDetail(m[1], (emails as Record<string, string>)[m[1]], m[1] === "e-long" ? (opts.paragraphs ?? 80) : 3));
    if (method === "GET" && path === "/tasks/counts") return json({ pending: tasks.length, done: 0, dismissed: 0, overdue: 0, today: 0, week: tasks.length, no_date: 0 });
    if (method === "GET" && path === "/tasks") return json(tasks);
    if (method === "PATCH" && path.startsWith("/tasks/")) return json({ ...tasks.find((t) => path.endsWith(t.id)), ...(JSON.parse(req.postData() || "{}")) });
    if (method === "GET" && path === "/commitments") return json([]);
    if (method === "POST" && /\/reply$/.test(path)) return json({ ok: true, id: "sent-1" });
    unhandled.push(`${method} ${path}`);
    return json(method === "GET" ? [] : {});
  });
  return { unhandled, calls };
}
