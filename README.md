# IMPI — Monitor de marcas

Herramienta para prácticas de PI en México: seguimiento de expedientes IMPI (7 dígitos) después de la concesión — declaración de uso, requerimientos, oficios, caducidad — con inbox de cambios y API de vencimientos.

Este Project reemplaza el stub vacío de [impi-screening](https://github.com/jcmartorell/impi-screening) (FastAPI “OK” en Replit). El producto vive aquí: dashboard Next.js + API + mock Marcanet.

## Qué incluye (v1)

- Dashboard: alta/listado de marcas, estatus actual, último movimiento, notificaciones in-app
- API HTTP para consultar estatus, marcas por vencer, dar de alta y listar notificaciones
- Refresh manual (y listo para schedule) que fetch → parse/diff → notifica
- Fetcher público Marcanet/SIGA con delays, backoff y **fallback mock** si el portal falla, rate-limita o muestra captcha
- SQLite local (`data/impi.sqlite`) con semillas de muestra
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
| `IMPI_FETCH_MODE` | `auto` \| `mock` \| `live` | `auto` (intenta live, cae a mock) |
| `PORT` | puerto | `3847` vía script `dev` |

Para demos offline:

```bash
IMPI_FETCH_MODE=mock npm run dev
```

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
Trigger (UI / POST /api/refresh)
  → Scraper/fetcher (Marcanet/SIGA público + mock)
  → Parser & diff (historial SQLite)
  → Notifier (inbox in-app; PASE/Slack/email stub/later)
```

## Semillas

Al primer arranque se cargan expedientes de muestra: `2451893`, `1987654`, `2234567`, `2567890`, `2109876`, `2345678`.

## Auth y límites

- Las rutas de cartera/notificaciones/refresh exigen identidad Cursor (`requireIdentity`). En local se simula un viewer (`cursor/identity.dev.ts`).
- Cada cartera está aislada por `sub` + stage (preview vs production).
- Tope de 50 expedientes por cartera; historial y notificaciones con poda; refresh con cooldown y ventana (429 + `Retry-After`).

## Límites conocidos

- El portal público IMPI es frágil (timeouts, captchas, HTML inestable). En la práctica v1 opera casi siempre en modo mock/auto-fallback.
- Persistencia en archivo SQLite local (no servicio de base de datos gestionado).
- PASE / Slack / email / WhatsApp / MARCia siguen fuera de alcance.
