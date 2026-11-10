export type TrademarkStatus =
  | "vigente"
  | "declaracion_de_uso"
  | "requerimiento"
  | "oficio"
  | "caducada"
  | "cancelada"
  | "renovacion"
  | "en_tramite"
  | "desconocida";

export type FetchSource = "live" | "mock";

export interface Movement {
  id: string;
  date: string;
  description: string;
  kind: string;
}

export interface TrademarkSnapshot {
  expediente: string;
  markName: string;
  owner: string;
  status: TrademarkStatus;
  statusLabel: string;
  classNice: string;
  grantDate: string | null;
  expiryDate: string | null;
  lastMovementDate: string | null;
  movements: Movement[];
  fetchedAt: string;
  source: FetchSource;
}

export interface TrackedMark {
  expediente: string;
  clientLabel: string;
  notes: string;
  trackedAt: string;
  lastRefreshedAt: string | null;
  current: TrademarkSnapshot | null;
}

export interface StatusHistoryEntry {
  id: string;
  expediente: string;
  status: TrademarkStatus;
  statusLabel: string;
  lastMovementDate: string | null;
  snapshot: TrademarkSnapshot;
  recordedAt: string;
}

export type NotificationKind =
  | "status_change"
  | "new_movement"
  | "expiry_warning"
  | "fetch_fallback"
  | "tracked";

export interface AppNotification {
  id: string;
  expediente: string;
  kind: NotificationKind;
  title: string;
  body: string;
  createdAt: string;
  read: boolean;
}

export interface RefreshResult {
  expediente: string;
  ok: boolean;
  source: FetchSource;
  changed: boolean;
  notificationsCreated: number;
  error?: string;
  snapshot?: TrademarkSnapshot;
}

export const STATUS_LABELS: Record<TrademarkStatus, string> = {
  vigente: "Vigente",
  declaracion_de_uso: "Declaración de uso",
  requerimiento: "Requerimiento",
  oficio: "Oficio",
  caducada: "Caducada",
  cancelada: "Cancelada",
  renovacion: "Renovación",
  en_tramite: "En trámite",
  desconocida: "Desconocida",
};
