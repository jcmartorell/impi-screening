# IMPI — Monitor de marcas

Herramienta para prácticas de PI en México: seguimiento de expedientes IMPI (7 dígitos) después de la concesión — declaración de uso, requerimientos, oficios, caducidad — con inbox de cambios y API de vencimientos.

Este Project reemplaza el stub vacío de [impi-screening](https://github.com/jcmartorell/impi-screening) (FastAPI “OK” en Replit). El producto vive aquí: dashboard Next.js + API + fetcher Marcanet/SIGA.

## Qué incluye (v1)

- Dashboard: alta/listado de marcas, estatus actual, último movimiento, notificaciones in-app
- API HTTP para consultar estatus, marcas por vencer, dar de alta y listar notificaciones
- Refresh manual (y listo para schedule) que fetch → parse/diff → notifica
- Fetcher público Marcanet/SIGA con delays y backoff; **modo live por defecto en Vercel/producción**
- Catálogo mock **solo** si `IMPI_FETCH_MODE=mock` (demos locales)
- SQLite local (`data/impi.sqlite`) con semillas de muestra para la UI
- Stub de capa PASE (sin login autenticado)

Fuera de alcance v1: PASE real, MARCia, WhatsApp/Twilio, Slack/email.

## Arranque local

```bash
npm install
npm run dev
```

Abre [http://127.0.0.1:3847](http://127.0.0.1:3847).

Variables opcionales:

| Variable | Valores | Default |
|---|---|---|
| `IMPI_FETCH_MODE` | `auto` \| `mock` \| `live` | `live` en Vercel/`NODE_ENV=production`; `auto` en local |
| `PORT` | puerto | `3847` vía script `dev` |

- **`live`**: consulta Marcanet/SIGA; si el portal falla (timeout, 403, captcha, HTML ilegible) **falla de forma visible** (502 + notificación `fetch_fallback`). No inventa datos.
- **`auto`**: intenta live primero; si falla, error visible (sin sustituir por catálogo mock).
- **`mock`**: catálogo de muestra — solo para demos offline locales.

```bash
# Demo offline con datos seed
IMPI_FETCH_MODE=mock npm run dev

# Forzar live en local (misma política que producción)
IMPI_FETCH_MODE=live npm run dev
```

En Vercel, `vercel.json` fija `IMPI_FETCH_MODE=live`.

## Probar un expediente real (producción)

1. Abre [https://impi-monitor.vercel.app](https://impi-monitor.vercel.app) (modo demo si no hay identidad Cursor).
2. En **Alta de expediente**, ingresa un expediente mexicano de **7 dígitos** real y pulsa dar de alta.
3. El servidor hace `POST /api/marks` → fetcher Marcanet/SIGA (`IMPI_FETCH_MODE=live`).
4. Si el portal responde y el HTML/JSON se parsea → verás `source: live` en la cartera.
5. Si hay captcha, rate-limit, timeout o parse fallido → error visible + aviso en el inbox (**no** se sirve el catálogo mock).

También: `POST /api/refresh` con `{ "expediente": "#######" }` (debe estar ya en tu cartera).

## API

| Método | Ruta | Descripción |
|---|---|---|
| `GET` | `/api/marks` | Lista marcas en seguimiento |
| `POST` | `/api/marks` | Alta `{ "expediente": "2451893", "clientLabel?": "..." }` |
| `GET` | `/api/marks/:expediente` | Estatus (+ `?refresh=1`) |
| `GET` | `/api/marks/expiring?days=90` | Marcas que vencen en N días |
| `GET` | `/api/notifications` | Inbox (`?unread=1`) |
| `PATCH` | `/api/notifications` | `{ "id" }` o `{ "all": true }` marcar leídas |
| `POST` | `/api/refresh` | Refresca toda la cartera o `{ "expediente" }` |

## Arquitectura

```
Trigger (UI / POST /api/refresh|/api/marks)
  → Scraper/fetcher (Marcanet/SIGA público; mock solo si IMPI_FETCH_MODE=mock)
  → Parser & diff (historial SQLite)
  → Notifier (inbox in-app; PASE/Slack/email stub/later)
```

## Semillas

Al primer arranque (UI demo) se cargan expedientes de muestra: `2451893`, `1987654`, `2234567`, `2567890`, `2109876`, `2345678`. Esas semillas alimentan la vista; **un alta/refresh en modo live no las sustituye por mock** si el portal falla.

## Auth y límites

- Las rutas de cartera/notificaciones/refresh exigen identidad Cursor (`requireIdentity`). En local se simula un viewer (`cursor/identity.dev.ts`).
- En Vercel sin `CURSOR_APP_ID`, hay fallback demo para ver la UI (no confundir con datos live).
- Cada cartera está aislada por `sub` + stage (preview vs production).
- Tope de 50 expedientes por cartera; historial y notificaciones con poda; refresh con cooldown y ventana (429 + `Retry-After`).

## Límites conocidos (portal público)

- Marcanet/SIGA es frágil desde entornos cloud: **timeouts**, **HTTP 403**, **captchas / Cloudflare**, HTML inestable o rate-limits.
- En modo `live`/`auto` eso se reporta como error (inbox `fetch_fallback`); no se finge un expediente seed.
- Persistencia en archivo SQLite local (en Vercel: `/tmp`).
- PASE / Slack / email / WhatsApp / MARCia siguen fuera de alcance.
