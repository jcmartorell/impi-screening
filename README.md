# IMPI — Monitor de marcas

Herramienta para prácticas de PI en México: **búsqueda en gacetas SIGA**, alta por expediente, seguimiento post-concesión (declaración de uso, requerimientos, oficios, caducidad), export CSV/JSON e inbox de cambios.

Este Project reemplaza el stub vacío de [impi-screening](https://github.com/jcmartorell/impi-screening). El producto vive aquí: dashboard Next.js + API + fetcher SIGA TuGaceta.

## Qué incluye

- **Búsqueda & descarga**: filtros por palabra/nombre, clase Niza, rango de fechas; selección múltiple; export CSV/JSON
- Dashboard: alta/listado de marcas, estatus, último movimiento, notificaciones in-app
- API HTTP para search, export, estatus, vencimientos y refresh
- Fetcher **live** vía SIGA TuGaceta (`https://siga.impi.gob.mx:5007`) con sesión CSRF
- Catálogo mock **solo** si `IMPI_FETCH_MODE=mock`
- Worker Playwright opcional cuando IMPI exige reCAPTCHA real (local/worker — no Vercel)

Fuera de alcance: PASE real, MARCia, WhatsApp/Twilio, Slack/email.

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
| `PORT` | puerto | `3847` vía script `dev` |

```bash
# Demo offline con datos seed
IMPI_FETCH_MODE=mock npm run dev

# Forzar live (misma política que producción)
IMPI_FETCH_MODE=live npm run dev
```

En Vercel, `vercel.json` fija `IMPI_FETCH_MODE=live`.

## Cómo usar búsqueda / export

1. Abre el dashboard → sección **Búsqueda y descarga**.
2. Ingresa palabra, nombre de marca o expediente; opcionalmente clase Niza y fechas.
3. Pulsa **Buscar en SIGA**. Verás estatus/sección, clase, gaceta y fechas por hit.
4. Marca varios resultados → **Exportar CSV** o **Exportar JSON**.
5. Para monitoreo continuo, copia un expediente de 7 dígitos a **Alta de expediente**.

API equivalente:

```bash
curl -X POST http://127.0.0.1:3847/api/search \
  -H 'content-type: application/json' \
  -d '{"keyword":"SOLARIS","classNice":"9","dateFrom":"2020-01-01","limit":50}'

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
| `POST` | `/api/marks` | Alta `{ "expediente": "2451893", "clientLabel?" }` |
| `GET` | `/api/marks/:expediente` | Estatus (+ `?refresh=1`) |
| `GET` | `/api/marks/expiring?days=90` | Marcas que vencen en N días |
| `GET` | `/api/notifications` | Inbox |
| `POST` | `/api/refresh` | Refresca cartera o `{ "expediente" }` |

## Auth

- Con `CURSOR_APP_ID`: identidad Cursor obligatoria.
- Sin `CURSOR_APP_ID` (p. ej. Vercel anónimo): simulación UI; en **live** la cartera arranca **vacía** (sin banners de “modo muestra / catálogo mock”).

## Worker Playwright

```bash
npm i -D playwright
npx playwright install chromium
IMPI_USE_PLAYWRIGHT=1 npm run siga:worker -- search --keyword SOLARIS --class 9
IMPI_USE_PLAYWRIGHT=1 npm run siga:token
```
