// Runs against the REAL local backend (http://localhost:8000 through the Vite proxy) and the local database.
//   E2E_LIVE_BACKEND=1 npx playwright test -c playwright.local.config.ts live-backend
// Outgoing mail is intercepted in the browser: nothing is ever sent.
import { expect, test } from "@playwright/test";

test.skip(!process.env.E2E_LIVE_BACKEND, "set E2E_LIVE_BACKEND=1 with the local backend running");

test.describe("Backend local real", () => {
  test("la bandeja carga cuentas, correos y estadísticas sin errores 5xx", async ({ page }) => {
    const bad: string[] = [];
    page.on("response", (r) => { if (r.url().includes("/api/") && r.status() >= 500 && r.status() !== 503) bad.push(`${r.status()} ${new URL(r.url()).pathname}`); });
    await page.goto("./");
    await expect(page.getByTestId("email-row").first()).toBeVisible();
    await page.getByRole("button", { name: /^Tareas/ }).first().click();
    await page.waitForTimeout(800);
    expect(bad, `respuestas 5xx inesperadas (503 = Gmail no configurado, esperado en local): ${bad.join(", ")}`).toEqual([]);
  });

  test("Responder, Resp. todos y Reenviar abren el editor con un correo real (sin enviar nada)", async ({ page }) => {
    const sent: string[] = [];
    await page.route(/\/api\/inbox\/(emails\/[^/]+\/(reply|forward)|compose)$/, async (route) => {
      sent.push(`${route.request().method()} ${new URL(route.request().url()).pathname}`);
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, id: "intercepted" }) });
    });
    await page.goto("./");
    await page.getByTestId("email-row").first().click();
    for (const [button, heading] of [["Responder", "Responder"], ["Resp. todos", "Responder a todos"], ["Reenviar", "Reenviar"]] as const) {
      await page.getByRole("button", { name: button, exact: true }).click();
      const composer = page.getByTestId("composer");
      await expect(composer.getByText(heading, { exact: true }).first()).toBeVisible();
      await expect(composer).toBeInViewport({ ratio: 0.4 });
    }
    await page.getByTestId("composer").locator("input").first().fill("destino@example.test");
    await page.getByTestId("composer").locator("textarea").fill("Prueba local, no se envía.");
    await page.getByTestId("composer").getByRole("button", { name: "Enviar", exact: true }).click();
    await page.getByRole("button", { name: "Confirmar y enviar" }).click();
    await expect.poll(() => sent.length).toBeGreaterThan(0);                                  // the click reached the (intercepted) API
  });
});
