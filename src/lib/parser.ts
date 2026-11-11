import type { TrademarkSnapshot, TrademarkStatus, Movement } from "@/lib/types";
import { STATUS_LABELS } from "@/lib/types";

const STATUS_PATTERNS: { status: TrademarkStatus; pattern: RegExp }[] = [
  { status: "caducada", pattern: /caducad/i },
  { status: "cancelada", pattern: /cancelad/i },
  { status: "declaracion_de_uso", pattern: /declaraci[oó]n\s+de\s+uso/i },
  { status: "requerimiento", pattern: /requerimiento/i },
  { status: "oficio", pattern: /oficio/i },
  { status: "renovacion", pattern: /renovaci[oó]n/i },
  {
    status: "vigente",
    pattern: /vigente|concedid|registro|marcas?\s+registrad/i,
  },
  { status: "en_tramite", pattern: /tr[aá]mite|pendiente|solicitud/i },
];

export function normalizeStatus(text: string | null | undefined): TrademarkStatus {
  if (!text) return "desconocida";
  for (const { status, pattern } of STATUS_PATTERNS) {
    if (pattern.test(text)) return status;
  }
  return "desconocida";
}

function extractJsonCandidate(body: string): Record<string, unknown> | null {
  try {
    const data = JSON.parse(body) as unknown;
    if (data && typeof data === "object") return data as Record<string, unknown>;
  } catch {
    // not JSON
  }
  return null;
}

function asString(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number") return String(value);
  return null;
}

function parseFromJson(
  expediente: string,
  data: Record<string, unknown>,
): TrademarkSnapshot | null {
  const markName =
    asString(data.marca) ??
    asString(data.markName) ??
    asString(data.denominacion) ??
    asString(data.nombre);
  const owner =
    asString(data.titular) ?? asString(data.owner) ?? asString(data.solicitante);
  const statusRaw =
    asString(data.estatus) ?? asString(data.status) ?? asString(data.estado);
  if (!markName && !statusRaw) return null;

  const status = normalizeStatus(statusRaw);
  const movementsRaw = Array.isArray(data.movimientos)
    ? data.movimientos
    : Array.isArray(data.movements)
      ? data.movements
      : [];

  const movements: Movement[] = movementsRaw
    .map((item, index) => {
      if (!item || typeof item !== "object") return null;
      const row = item as Record<string, unknown>;
      const date =
        asString(row.fecha) ?? asString(row.date) ?? asString(row.fechaMovimiento);
      const description =
        asString(row.descripcion) ??
        asString(row.description) ??
        asString(row.movimiento);
      if (!date || !description) return null;
      return {
        id: `${expediente}-live-${index}`,
        date,
        description,
        kind: asString(row.tipo) ?? asString(row.kind) ?? "movimiento",
      };
    })
    .filter((m): m is Movement => Boolean(m));

  const lastMovementDate =
    movements[0]?.date ??
    asString(data.ultimaFecha) ??
    asString(data.lastMovementDate);

  return {
    expediente,
    markName: markName ?? `Expediente ${expediente}`,
    owner: owner ?? "Titular no disponible",
    status,
    statusLabel: statusRaw ?? STATUS_LABELS[status],
    classNice: asString(data.clase) ?? asString(data.classNice) ?? "—",
    grantDate: asString(data.fechaConcesion) ?? asString(data.grantDate),
    expiryDate: asString(data.fechaVigencia) ?? asString(data.expiryDate),
    lastMovementDate,
    movements,
    fetchedAt: new Date().toISOString(),
    source: "live",
  };
}

function stripTags(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function parseFromHtml(expediente: string, html: string): TrademarkSnapshot | null {
  const text = stripTags(html);
  if (text.length < 40) return null;

  const status = normalizeStatus(text);
  if (status === "desconocida" && !/expediente|marca|impi|titular/i.test(text)) {
    return null;
  }

  const nameMatch =
    text.match(/denominaci[oó]n[:\s]+([A-ZÁÉÍÓÚÑ0-9][\wÁÉÍÓÚÑáéíóúñ &.-]{2,60})/i) ??
    text.match(/marca[:\s]+([A-ZÁÉÍÓÚÑ0-9][\wÁÉÍÓÚÑáéíóúñ &.-]{2,60})/i);
  const ownerMatch = text.match(
    /titular[:\s]+([A-ZÁÉÍÓÚÑ][\wÁÉÍÓÚÑáéíóúñ &.,-]{3,80})/i,
  );

  return {
    expediente,
    markName: nameMatch?.[1]?.trim() ?? `Expediente ${expediente}`,
    owner: ownerMatch?.[1]?.trim() ?? "Titular no disponible",
    status,
    statusLabel: STATUS_LABELS[status],
    classNice: "—",
    grantDate: null,
    expiryDate: null,
    lastMovementDate: null,
    movements: [],
    fetchedAt: new Date().toISOString(),
    source: "live",
  };
}

/** Parse a public portal HTML or JSON body into a normalized snapshot. */
export function parsePublicHtml(
  expediente: string,
  body: string,
  contentType: string,
): TrademarkSnapshot | null {
  if (contentType.includes("json") || body.trim().startsWith("{") || body.trim().startsWith("[")) {
    const json = extractJsonCandidate(body);
    if (json) {
      const nested =
        (json.data as Record<string, unknown> | undefined) ??
        (json.resultado as Record<string, unknown> | undefined) ??
        json;
      const fromJson = parseFromJson(expediente, nested);
      if (fromJson) return fromJson;
    }
  }
  return parseFromHtml(expediente, body);
}
