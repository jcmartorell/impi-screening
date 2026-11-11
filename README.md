# IMPI — Monitor de marcas

Herramienta para prácticas de PI en México: **búsqueda en gacetas SIGA** (flujo principal), export CSV/JSON y seguimiento opcional de expedientes post-concesión (declaración de uso, requerimientos, oficios, caducidad) con inbox de cambios.

Este Project reemplaza el stub vacío de [impi-screening](https://github.com/jcmartorell/impi-screening). El producto vive aquí: dashboard Next.js + API + fetcher SIGA TuGaceta.

## Qué incluye

- **Búsqueda**: filtros por palabra/nombre, fechas, sector y clase Niza; selección múltiple; export CSV/JSON; seguir seleccionados
- Cartera de seguimiento (opcional) con estatus, último movimiento e inbox
- API HTTP para search, export, estatus, vencimientos y refresh
- Fetcher **live** vía SIGA TuGaceta (`https://siga.impi.gob.mx:5007`) con sesión CSRF
- Catálogo mock **solo** si `IMPI_FETCH_MODE=mock`
- Worker Playwright opcional cuando IMPI exige reCAPTCHA real (local/worker — no Vercel)

Fuera de alcance: PASE real, MARCia, WhatsApp/Twilio, Slack. Email de alertas: Resend o SMTP (ver abajo).

## Arranque local

```bash
npm install
npm run dev
```

Abre [http://127.0.0.1:3847](http://127.0.0.1:3847).

| Variable | Valores | Default |
|---|---|---|
| `IMPI_FETCH_MODE` | `auto` \| `mock` \| `live` | `live` en Vercel/producción; `auto` en local |
| `IMPI_SIGA_API_BASE` | URL API TuGaceta | `https://siga.impi.gob.mx:5007` |
| `IMPI_USE_PLAYWRIGHT` | `1` para obtener token reCAPTCHA | off |
| `IMPI_RECAPTCHA_TOKEN` | token v3 preobtenido | — |
| `RESEND_API_KEY` | envío de alertas vía Resend | vacío → log local |
| `EMAIL_FROM` / `RESEND_FROM` | remitente | `IMPI Monitor <onboarding@resend.dev>` |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `SMTP_PASS` | alternativa SMTP | — |
| `CRON_SECRET` | protege `GET/POST /api/cron/refresh` | requerido en prod sin header Vercel |
| `PORT` | puerto | `3847` vía script `dev` |

```bash
# Demo offline con datos seed
IMPI_FETCH_MODE=mock npm run dev

# Forzar live (misma política que producción)
IMPI_FETCH_MODE=live npm run dev
```

En Vercel, `vercel.json` fija `IMPI_FETCH_MODE=live`.

## Cómo usar búsqueda / export

1. Abre el dashboard → sección **Búsqueda** (CTA principal).
2. Ingresa palabra, nombre de marca o expediente; opcionalmente sector, clase Niza y fechas.
3. Pulsa **Buscar en SIGA**. Verás estatus/sección, clase, gaceta y fechas por hit.
4. Marca varios resultados → **Exportar CSV** / **Exportar JSON**, o **Seguir seleccionados**.
5. Opcional: si ya conoces el número, usa **Seguir por expediente**.

API equivalente:

```bash
curl -X POST http://127.0.0.1:3847/api/search \
  -H 'content-type: application/json' \
  -d '{"keyword":"SOLARIS","classNice":"9","sector":"marcas","dateFrom":"2020-01-01","limit":50}'

curl -X POST http://127.0.0.1:3847/api/export \
  -H 'content-type: application/json' \
  -d '{"format":"csv","hits":[...]}'
```

## Live vs captcha (honestidad)

| Ruta | Qué es |
|---|---|
| `https://siga.impi.gob.mx:5007/api/BusquedaFicha/*` | **API real** TuGaceta (CSRF + `reCaptchaToken`) |
| `https://siga.impi.gob.mx/newsiga/rest/expediente/{id}` | Shell Angular + reCAPTCHA — **no** JSON de expediente |
| `marcanet.impi.gob.mx` | A menudo irresoluble / frágil desde cloud |

- Con CSRF válido, muchos endpoints aceptan hoy un placeholder de captcha desde IPs cloud. Si IMPI endurece la validación:
  - **Vercel no puede resolver captcha server-side** (sin browser).
  - Usa worker local: `npm i -D playwright && npx playwright install chromium`
  - `IMPI_USE_PLAYWRIGHT=1 npm run siga:worker -- search --keyword SOLARIS`
  - o `IMPI_RECAPTCHA_TOKEN=...` en el proceso Node fuera de Vercel.

En modo `live`/`auto`, fallos del portal se muestran (502 + inbox) — **nunca** se sustituye por catálogo mock.

## API

| Método | Ruta | Descripción |
|---|---|---|
| `GET/POST` | `/api/search` | Búsqueda TuGaceta (keyword, clase, fechas, sector) |
| `POST` | `/api/export` | `{ format: "csv"\|"json", hits: [...] }` descarga |
| `GET` | `/api/marks` | Lista marcas en seguimiento |
| `POST` | `/api/marks` | Seguir `{ "expediente": "1240512", "clientLabel?" }` |
| `GET` | `/api/marks/:expediente` | Estatus (+ `?refresh=1`) |
| `GET` | `/api/marks/expiring?days=90` | Marcas que vencen en N días |
| `GET` | `/api/notifications` | Inbox |
| `POST` | `/api/refresh` | Refresca cartera o `{ "expediente" }` |
| `GET/PATCH` | `/api/settings` | `{ alertEmail }` destino de alertas (vacío = off) |
| `GET/POST` | `/api/cron/refresh` | Cron Vercel: refresca carteras (Bearer `CRON_SECRET`) |

### Alertas por correo

1. En **Seguimiento / monitoreo → Ajustes de alertas**, pega el correo destino (vacío = no envía).
2. Configura en Vercel `RESEND_API_KEY` (preferido) o `SMTP_*`. Sin clave, el servidor solo registra el email en logs.
3. `vercel.json` programa cron cada 6 h → `/api/cron/refresh` (solo lista de seguimiento; no busca).

## Auth

- Con `CURSOR_APP_ID`: identidad Cursor obligatoria.
- Sin `CURSOR_APP_ID` (p. ej. Vercel anónimo): simulación UI; en **live** la cartera arranca **vacía** (sin banners de “modo muestra / catálogo mock”).

## Worker Playwright

```bash
npm i -D playwright
npx playwright install chromium
IMPI_USE_PLAYWRIGHT=1 npm run siga:worker -- search --keyword SOLARIS --class 9
IMPI_USE_PLAYWRIGHT=1 npm run siga:worker -- expediente 1240512
IMPI_USE_PLAYWRIGHT=1 npm run siga:token
```
