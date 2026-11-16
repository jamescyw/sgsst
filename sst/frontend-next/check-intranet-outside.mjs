import { chromium } from "playwright-core";

const browser = await chromium.launch({
  headless: true,
  executablePath:
    "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
});
try {
  const page = await browser.newPage();
  const response = await page.goto("http://localhost:3002");
  const csp = response?.headers()["content-security-policy"] || "";
  if (!csp.includes("frame-ancestors https://intranet-v2.crepesywaffles.com")) {
    throw new Error("Falta la política frame-ancestors de la Intranet");
  }
  await page
    .getByText("Abre esta aplicación desde la Intranet para iniciar sesión.", {
      exact: true,
    })
    .waitFor();
  if (await page.getByLabel("Token de acceso").count()) {
    throw new Error("Producción está mostrando el acceso manual de desarrollo");
  }
  console.log("Producción exige Intranet y envía CSP: OK");
} finally {
  await browser.close();
}
