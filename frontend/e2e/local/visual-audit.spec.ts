// Layout audit: every view at three viewports. Fails on horizontal overflow, clipped/ellipsised text and overlapping controls.
// Screenshots go to test-results/audit/ (not committed) so the layout can be inspected by eye too.
import { expect, test, type Page } from "@playwright/test";
import fs from "node:fs";
import { mockApi, task } from "./fixtures";

const VIEWPORTS = [{ name: "desktop", width: 1280, height: 720 }, { name: "small", width: 1024, height: 640 }, { name: "mobile", width: 390, height: 800 }];
const VIEWS: { name: string; go: (p: Page) => Promise<void> }[] = [
  { name: "inbox-open", go: async (p) => { await p.getByText("Propuesta con plazo (correo largo)").first().click(); } },
  { name: "tasks", go: async (p) => { await clickNav(p, "tasks"); } },
  { name: "commitments", go: async (p) => { await clickNav(p, "commitments"); } },
  { name: "agent_today", go: async (p) => { await clickNav(p, "agent_today"); } },
  { name: "agent_calendar_week", go: async (p) => { await clickNav(p, "agent_calendar"); } },
  { name: "agent_calendar_month", go: async (p) => { await clickNav(p, "agent_calendar"); await p.getByRole("tab", { name: "Mes" }).click(); } },
  { name: "agent_calendar_agenda", go: async (p) => { await clickNav(p, "agent_calendar"); await p.getByRole("tab", { name: "Agenda" }).click(); } },
  { name: "agent_cases", go: async (p) => { await clickNav(p, "agent_cases"); } },
  { name: "agent_search", go: async (p) => { await clickNav(p, "agent_search"); } },
  { name: "agent_orders", go: async (p) => { await clickNav(p, "agent_orders"); } },
];
const LABEL: Record<string, RegExp> = { tasks: /^Tareas/, commitments: /^Compromisos/, agent_today: /^Hoy/, agent_calendar: /^Calendario/, agent_cases: /^Casos/, agent_search: /Buscar en todo/, agent_orders: /Órdenes a Chatita/ };

async function clickNav(page: Page, key: string) {
  const vw = page.viewportSize()!.width;
  if (vw < 768) await page.getByRole("button", { name: "Menu" }).click();                      // the sidebar is a drawer on phones
  await page.getByRole("button", { name: LABEL[key] }).first().click();
}

async function audit(page: Page) {
  return page.evaluate(() => {
    const issues: string[] = [];
    const vw = window.innerWidth;
    if (document.documentElement.scrollWidth > vw + 1) issues.push(`desbordamiento horizontal del documento (${document.documentElement.scrollWidth} > ${vw})`);
    // visible = has size, is not hidden, is inside the viewport and is not clipped away by a scrolling/overflow-hidden ancestor
    const visible = (el: Element) => {
      const r = el.getBoundingClientRect(); const cs = getComputedStyle(el);
      if (!(r.width > 0 && r.height > 0) || cs.visibility === "hidden" || cs.display === "none") return false;
      if (r.right <= 0 || r.left >= window.innerWidth || r.bottom <= 0 || r.top >= window.innerHeight) return false;
      for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
        const o = getComputedStyle(p);
        if (o.overflowX === "visible" && o.overflowY === "visible") continue;
        const pr = p.getBoundingClientRect();
        if (Math.min(r.right, pr.right) - Math.max(r.left, pr.left) < 4 || Math.min(r.bottom, pr.bottom) - Math.max(r.top, pr.top) < 4) return false;
      }
      return true;
    };
    const describe = (el: Element) => `${el.tagName.toLowerCase()}[${(el.getAttribute("aria-label") || el.textContent || "").trim().slice(0, 30)}]`;
    for (const el of Array.from(document.querySelectorAll("main *, #root *"))) {
      if (!visible(el)) continue;
      const cs = getComputedStyle(el);
      if (el.closest('[data-testid="cal-event"]') || el.closest('[data-expandable]')) continue;      // deliberate: full text in the tooltip / detail panel / "ver más"
      if ((cs.textOverflow === "ellipsis" || cs.getPropertyValue("-webkit-line-clamp") !== "none" && cs.getPropertyValue("-webkit-line-clamp") !== "") && (el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1) && el.textContent?.trim())
        issues.push(`texto cortado: ${describe(el)}`);
      const r = el.getBoundingClientRect();
      if (["BUTTON", "A", "INPUT", "SELECT"].includes(el.tagName) && (r.right > vw + 1 || r.left < -1)) issues.push(`control fuera de la pantalla: ${describe(el)}`);
    }
    const controls = Array.from(document.querySelectorAll("button, a, input, select, textarea")).filter(visible);
    for (let i = 0; i < controls.length; i++) for (let j = i + 1; j < controls.length; j++) {
      const a = controls[i], b = controls[j];
      if (a.contains(b) || b.contains(a)) continue;
      const ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect();
      const w = Math.min(ra.right, rb.right) - Math.max(ra.left, rb.left), h = Math.min(ra.bottom, rb.bottom) - Math.max(ra.top, rb.top);
      if (w > 3 && h > 3) issues.push(`controles encimados: ${describe(a)} y ${describe(b)}`);
    }
    return Array.from(new Set(issues)).slice(0, 12);
  });
}

for (const vp of VIEWPORTS) {
  test.describe(`auditoría de diseño ${vp.name} ${vp.width}x${vp.height}`, () => {
    test.use({ viewport: { width: vp.width, height: vp.height } });
    for (const v of VIEWS) {
      test(`${v.name}`, async ({ page }) => {
        const far = new Date(Date.now() + 30 * 86400_000).toISOString();
        await mockApi(page, {
          paragraphs: 40,
          tasks: [task("t1", "e-long", "Actualizar el método de pago predeterminado de la suscripción con un texto largo que debe bajar de renglón sin cortarse", { deadline: far, task_type: "payment" }),
                  task("t2", "e-long", "Informar al proveedor que el pago de la orden G1686168 está completo", { deadline: null, task_type: "reply" })],
          commitments: [{ id: "c1", email_id: "e-long", who: "me", what: "Enviar el dictamen firmado a la contraparte antes del cierre del plazo procesal", deadline: new Date(Date.now() + 2 * 86400_000).toISOString(), status: "pending" }],
        });
        await page.goto("./");
        await expect(page.getByTestId("email-row").first()).toBeVisible();
        await v.go(page);
        await page.waitForTimeout(500);
        fs.mkdirSync("test-results/audit", { recursive: true });
        await page.screenshot({ path: `test-results/audit/${vp.name}-${v.name}.png` });
        expect(await audit(page), `${vp.name} / ${v.name}`).toEqual([]);
      });
    }
  });
}
