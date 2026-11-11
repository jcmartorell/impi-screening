#!/usr/bin/env node
/**
 * Local/worker SIGA helper — runs where Playwright/Chromium can execute.
 *
 * Usage:
 *   node scripts/siga-worker.mjs search --keyword SOLARIS [--class 9] [--from 2020-01-01] [--to 2025-12-31]
 *   node scripts/siga-worker.mjs expediente 2451893
 *   IMPI_USE_PLAYWRIGHT=1 node scripts/siga-worker.mjs token
 *
 * On Vercel serverless, Playwright is not available; use this script on a
 * laptop/worker host and feed results into the app, or call the app's
 * /api/search when TuGaceta CSRF path works without a real captcha token.
 */

import { chromium } from "playwright";

const API = process.env.IMPI_SIGA_API_BASE || "https://siga.impi.gob.mx:5007";
const ORIGIN = "https://siga.impi.gob.mx";
const SITE_KEY = "6LeRdm0pAAAAAOprsyOxSYwiBsVUmGSMdnCuA-P6";
const DEFAULT_GACETAS = [1, 35, 37, 40, 30, 36, 18, 81];

function parseArgs(argv) {
  const [cmd, ...rest] = argv;
  const flags = {};
  const positional = [];
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const val = rest[i + 1] && !rest[i + 1].startsWith("--") ? rest[++i] : "true";
      flags[key] = val;
    } else {
      positional.push(a);
    }
  }
  return { cmd, flags, positional };
}

async function getCsrf() {
  const jar = new Map();
  const res = await fetch(`${API}/antiforgery/token`, {
    headers: { Origin: ORIGIN, Referer: `${ORIGIN}/` },
  });
  const raw = typeof res.headers.getSetCookie === "function"
    ? res.headers.getSetCookie()
    : [res.headers.get("set-cookie")].filter(Boolean);
  for (const c of raw) {
    const pair = String(c).split(";")[0];
    const eq = pair.indexOf("=");
    if (eq > 0) jar.set(pair.slice(0, eq), pair.slice(eq + 1));
  }
  if (!jar.get("XSRF-TOKEN")) throw new Error("No XSRF-TOKEN from SIGA");
  return jar;
}

async function getRecaptchaToken(action = "inicioPage") {
  const browser = await chromium.launch({
    headless: true,
    args: ["--no-sandbox"],
  });
  try {
    const page = await browser.newPage();
    await page.goto(ORIGIN, { waitUntil: "domcontentloaded", timeout: 45_000 });
    await page.waitForFunction(
      () => typeof window.grecaptcha?.execute === "function",
      { timeout: 30_000 },
    );
    return await page.evaluate(
      async ({ siteKey, actionName }) => {
        await new Promise((r) => window.grecaptcha.ready(() => r()));
        return window.grecaptcha.execute(siteKey, { action: actionName });
      },
      { siteKey: SITE_KEY, actionName: action },
    );
  } finally {
    await browser.close();
  }
}

async function apiPost(jar, path, body, captcha) {
  const headers = {
    "Content-Type": "application/json",
    Accept: "application/json",
    Origin: ORIGIN,
    Referer: `${ORIGIN}/`,
    Cookie: [...jar.entries()].map(([k, v]) => `${k}=${v}`).join("; "),
    "X-XSRF-TOKEN": jar.get("XSRF-TOKEN"),
  };
  const payload =
    typeof body === "object" && body
      ? { ...body, reCaptchaToken: captcha || body.reCaptchaToken || "worker" }
      : body;
  const res = await fetch(`${API}${path}`, {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
  });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* ignore */
  }
  return { status: res.status, json, text };
}

async function main() {
  const { cmd, flags, positional } = parseArgs(process.argv.slice(2));
  if (!cmd || cmd === "help") {
    console.log(`Usage:
  node scripts/siga-worker.mjs search --keyword TEXT [--class 9] [--from YYYY-MM-DD] [--to YYYY-MM-DD]
  node scripts/siga-worker.mjs expediente 2451893
  node scripts/siga-worker.mjs token`);
    process.exit(0);
  }

  if (cmd === "token") {
    const token = await getRecaptchaToken();
    console.log(JSON.stringify({ ok: true, tokenLength: token.length, token }));
    return;
  }

  const jar = await getCsrf();
  let captcha = process.env.IMPI_RECAPTCHA_TOKEN || "worker";
  if (process.env.IMPI_USE_PLAYWRIGHT === "1") {
    captcha = await getRecaptchaToken();
  }

  if (cmd === "search") {
    const keyword = flags.keyword || positional[0];
    if (!keyword) throw new Error("--keyword required");
    const toDdMm = (s) => {
      if (!s) return "";
      const m = String(s).match(/^(\d{4})-(\d{2})-(\d{2})/);
      return m ? `${m[3]}/${m[2]}/${m[1]}` : s;
    };
    const { status, json, text } = await apiPost(
      jar,
      "/api/BusquedaFicha/GetFichas",
      {
        busqueda: keyword,
        idArea: "2",
        idGaceta: DEFAULT_GACETAS,
        fechaDesde: toDdMm(flags.from),
        fechaHasta: toDdMm(flags.to),
      },
      captcha,
    );
    if (status >= 400) {
      console.error(text);
      process.exit(1);
    }
    let rows = Array.isArray(json?.data) ? json.data : [];
    if (flags.class) {
      const want = String(flags.class).split(/[,\s]+/);
      rows = rows.filter((r) => {
        const clase = (r.datos || []).find((d) => /clase/i.test(d.descripcion))?.datoTxt || "";
        return want.some((c) => clase.split(/[,\s]+/).includes(c));
      });
    }
    console.log(JSON.stringify({ ok: true, count: rows.length, data: rows.slice(0, 200) }, null, 2));
    return;
  }

  if (cmd === "expediente") {
    const exp = (positional[0] || "").replace(/\D/g, "");
    if (!exp) throw new Error("expediente required");
    const { status, json, text } = await apiPost(
      jar,
      "/api/BusquedaFicha/GetFichas",
      {
        busqueda: exp,
        idArea: "2",
        idGaceta: DEFAULT_GACETAS,
        fechaDesde: "",
        fechaHasta: "",
      },
      captcha,
    );
    if (status >= 400) {
      console.error(text);
      process.exit(1);
    }
    const rows = (json?.data || []).filter((r) =>
      (r.datos || []).some(
        (d) => d.descripcion === "Expediente" && String(d.datoTxt).replace(/\D/g, "") === exp,
      ),
    );
    console.log(JSON.stringify({ ok: true, count: rows.length, data: rows }, null, 2));
    return;
  }

  throw new Error(`Unknown command: ${cmd}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
