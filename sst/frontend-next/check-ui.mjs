import { chromium } from "playwright-core";
import { readFileSync, mkdirSync } from "node:fs";
const env = readFileSync("../backend/.env", "utf8");
const token = env
  .match(/^API_TOKEN=(.*)$/m)?.[1]
  ?.trim()
  .replace(/^['"]|['"]$/g, "");
const appUrl = process.env.CHECK_UI_URL || "http://localhost:3002";
if (!token) throw Error("API_TOKEN no configurado");
const browser = await chromium.launch({
  headless: true,
  executablePath:
    "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
});
try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
  });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(appUrl);
  await page.getByLabel("Token de acceso").fill(token);
  await page.getByRole("button", { name: "Ingresar", exact: true }).click();
  await page
    .getByRole("button", { name: "Ver seguimientos", exact: true })
    .first()
    .waitFor({ timeout: 90000 });
  await page.getByRole("region", { name: "Usuario autenticado" }).waitFor();
  await page.getByText("Sesión local de desarrollo", { exact: true }).waitFor();
  await page.getByText("Distribución IMC", { exact: true }).waitFor();
  const workspace = await page.evaluate(async () => {
    const token = sessionStorage.getItem("sst_token");
    return fetch("/backend/sgsst/salud_general/workspace", {
      headers: { Authorization: `Bearer ${token}` },
    }).then((r) => r.json());
  });
  const expectedFollowing = workspace.reports.filter(
    (report) => report.StateId?.Name === "En Seguimiento",
  ).length;
  const followingKpi = page.getByRole("button", { name: /En Seguimiento/ });
  if (
    !new RegExp(`En Seguimiento\\s*${expectedFollowing}`).test(
      (await followingKpi.innerText()).replace(/\s+/g, " "),
    )
  )
    throw Error(
      `KPI En Seguimiento no coincide: se esperaban ${expectedFollowing}`,
    );
  await followingKpi.click();
  await page.getByText(new RegExp(`^${expectedFollowing} casos`)).waitFor();
  await followingKpi.click();
  const tablePhoto = page.locator('tbody img[alt^="Foto de "]').first();
  await tablePhoto.waitFor({ timeout: 15000 });
  console.log("Login + tabla + graficos OK");
  await page
    .getByRole("button", { name: "Ver seguimientos", exact: true })
    .nth(1)
    .click();
  await page.getByRole("dialog", { name: "Detalle del caso" }).waitFor();
  const detail = page.getByRole("dialog", { name: "Detalle del caso" });
  await detail.getByText("Colaborador", { exact: true }).first().waitFor();
  await detail.getByText("Reportado por", { exact: true }).first().waitFor();
  await detail
    .getByText("Seguimiento realizado por", { exact: true })
    .first()
    .waitFor();
  const visiblePeople = await detail
    .locator('img[alt^="Foto de "], [aria-label^="Sin foto de "]')
    .count();
  if (visiblePeople < 3)
    throw Error("Faltan avatares de colaborador, reportante o seguimiento");
  await page.getByRole("button", { name: "Nueva acción", exact: true }).click();
  await page
    .getByRole("heading", { name: "Nueva acción", exact: true })
    .waitFor();
  await page.getByRole("button", { name: "Cancelar", exact: true }).click();
  await page
    .getByRole("dialog", { name: "Detalle del caso" })
    .getByRole("button", { name: "Cerrar", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Osteomuscular", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Ver seguimientos", exact: true })
    .first()
    .waitFor({ timeout: 90000 });
  await page.getByText("Segmentos corporales", { exact: true }).waitFor();
  await page
    .getByRole("button", { name: "Nuevo reporte", exact: true })
    .click();
  await page
    .getByRole("heading", { name: "Nuevo reporte", exact: true })
    .waitFor();
  await page.getByRole("button", { name: "Cancelar", exact: true }).click();
  await page.getByRole("button", { name: "Salud Mental", exact: true }).click();
  await page
    .getByText("No hay casos para estos filtros.", { exact: true })
    .waitFor({ timeout: 60000 });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(700);
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth + 1,
  );
  if (overflow) throw Error("Desbordamiento horizontal móvil");
  if (errors.length) throw Error(errors.join("\n"));
  console.log("Modulos + formularios + modal + movil OK; sin escrituras");
} finally {
  await browser.close();
}
