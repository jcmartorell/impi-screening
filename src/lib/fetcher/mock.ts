import type { TrademarkSnapshot, TrademarkStatus } from "@/lib/types";
import { STATUS_LABELS } from "@/lib/types";

interface MockSeed {
  markName: string;
  owner: string;
  status: TrademarkStatus;
  classNice: string;
  grantDate: string;
  expiryDate: string;
  lastMovementDate: string;
  movements: { date: string; description: string; kind: string }[];
}

/** Realistic sample Mexican trademark dockets for offline demos. */
export const MOCK_CATALOG: Record<string, MockSeed> = {
  "2451893": {
    markName: "SOLARIS ENERGÍA",
    owner: "Solaris Energía S.A. de C.V.",
    status: "declaracion_de_uso",
    classNice: "9, 42",
    grantDate: "2022-03-18",
    expiryDate: "2032-03-18",
    lastMovementDate: "2025-11-02",
    movements: [
      {
        date: "2025-11-02",
        description: "Plazo de declaración de uso próximo a vencer",
        kind: "declaracion_de_uso",
      },
      {
        date: "2022-03-18",
        description: "Título de registro concedido",
        kind: "concesion",
      },
      {
        date: "2021-09-04",
        description: "Publicación en Gaceta de la Propiedad Industrial",
        kind: "publicacion",
      },
    ],
  },
  "1987654": {
    markName: "CAFÉ ALTURA",
    owner: "Beneficio Altura del Sur S. de R.L.",
    status: "requerimiento",
    classNice: "30",
    grantDate: "2020-07-11",
    expiryDate: "2030-07-11",
    lastMovementDate: "2025-10-28",
    movements: [
      {
        date: "2025-10-28",
        description: "Requerimiento de información sobre uso efectivo",
        kind: "requerimiento",
      },
      {
        date: "2024-08-15",
        description: "Declaración de uso presentada",
        kind: "declaracion_de_uso",
      },
      {
        date: "2020-07-11",
        description: "Título de registro concedido",
        kind: "concesion",
      },
    ],
  },
  "2234567": {
    markName: "TECNOVA MX",
    owner: "Tecnova México S.A.P.I. de C.V.",
    status: "oficio",
    classNice: "35, 42",
    grantDate: "2021-11-30",
    expiryDate: "2031-11-30",
    lastMovementDate: "2025-11-05",
    movements: [
      {
        date: "2025-11-05",
        description: "Oficio de notificación — respuesta pendiente",
        kind: "oficio",
      },
      {
        date: "2025-09-12",
        description: "Actualización de domicilio procesal",
        kind: "tramite",
      },
      {
        date: "2021-11-30",
        description: "Título de registro concedido",
        kind: "concesion",
      },
    ],
  },
  "2567890": {
    markName: "RUTA NORTE",
    owner: "Logística Ruta Norte S.A. de C.V.",
    status: "caducada",
    classNice: "39",
    grantDate: "2014-02-20",
    expiryDate: "2024-02-20",
    lastMovementDate: "2024-05-03",
    movements: [
      {
        date: "2024-05-03",
        description: "Declaratoria de caducidad por falta de renovación",
        kind: "caducidad",
      },
      {
        date: "2023-11-01",
        description: "Aviso de vencimiento de vigencia",
        kind: "aviso",
      },
      {
        date: "2014-02-20",
        description: "Título de registro concedido",
        kind: "concesion",
      },
    ],
  },
  "2109876": {
    markName: "BOSQUE VERDE",
    owner: "Productos Bosque Verde S.A. de C.V.",
    status: "vigente",
    classNice: "3, 5",
    grantDate: "2019-05-22",
    expiryDate: "2029-05-22",
    lastMovementDate: "2023-06-01",
    movements: [
      {
        date: "2023-06-01",
        description: "Declaración de uso aceptada",
        kind: "declaracion_de_uso",
      },
      {
        date: "2019-05-22",
        description: "Título de registro concedido",
        kind: "concesion",
      },
    ],
  },
  "2345678": {
    markName: "HORIZONTE LEGAL",
    owner: "Horizonte Legal Abogados S.C.",
    status: "renovacion",
    classNice: "45",
    grantDate: "2016-09-08",
    expiryDate: "2027-01-15",
    lastMovementDate: "2026-10-10",
    movements: [
      {
        date: "2026-10-10",
        description: "Ventana de renovación abierta",
        kind: "renovacion",
      },
      {
        date: "2016-09-08",
        description: "Título de registro concedido",
        kind: "concesion",
      },
    ],
  },
};

function synthesizeUnknown(expediente: string): MockSeed {
  const n = Number(expediente) || 0;
  const statuses: TrademarkStatus[] = [
    "vigente",
    "declaracion_de_uso",
    "requerimiento",
    "oficio",
    "en_tramite",
  ];
  const status = statuses[n % statuses.length];
  const year = 2016 + (n % 8);
  return {
    markName: `MARCA ${expediente}`,
    owner: `Titular demo ${expediente.slice(-3)} S.A. de C.V.`,
    status,
    classNice: String(1 + (n % 45)),
    grantDate: `${year}-06-15`,
    expiryDate: `${year + 10}-06-15`,
    lastMovementDate: "2025-09-20",
    movements: [
      {
        date: "2025-09-20",
        description: `Movimiento sintético (${STATUS_LABELS[status]})`,
        kind: status,
      },
      {
        date: `${year}-06-15`,
        description: "Título de registro concedido",
        kind: "concesion",
      },
    ],
  };
}

export function buildMockSnapshot(expediente: string): TrademarkSnapshot {
  const seed = MOCK_CATALOG[expediente] ?? synthesizeUnknown(expediente);
  const now = new Date().toISOString();
  return {
    expediente,
    markName: seed.markName,
    owner: seed.owner,
    status: seed.status,
    statusLabel: STATUS_LABELS[seed.status],
    classNice: seed.classNice,
    grantDate: seed.grantDate,
    expiryDate: seed.expiryDate,
    lastMovementDate: seed.lastMovementDate,
    movements: seed.movements.map((m, i) => ({
      id: `${expediente}-m${i}`,
      date: m.date,
      description: m.description,
      kind: m.kind,
    })),
    fetchedAt: now,
    source: "mock",
  };
}
