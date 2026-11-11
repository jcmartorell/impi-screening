import type { AppNotification } from "@/lib/types";

export type EmailSendMode = "resend" | "smtp" | "log";

export type EmailSendResult = {
  ok: boolean;
  mode: EmailSendMode;
  skipped?: "no_destination" | "empty";
  error?: string;
  messageId?: string;
};

const ALERT_KINDS = new Set([
  "status_change",
  "new_movement",
  "expiry_warning",
]);

function emailFrom(): string {
  return (
    process.env.EMAIL_FROM?.trim() ||
    process.env.RESEND_FROM?.trim() ||
    "IMPI Monitor <onboarding@resend.dev>"
  );
}

function isValidEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

/** Kinds that warrant an outbound email (modifications / vencimiento). */
export function isEmailAlertKind(kind: AppNotification["kind"]): boolean {
  return ALERT_KINDS.has(kind);
}

export function filterEmailAlerts(
  notifications: AppNotification[],
): AppNotification[] {
  return notifications.filter((n) => isEmailAlertKind(n.kind));
}

async function sendViaResend(input: {
  to: string;
  subject: string;
  text: string;
  html: string;
}): Promise<EmailSendResult> {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  if (!apiKey) {
    return { ok: false, mode: "resend", error: "RESEND_API_KEY missing" };
  }

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: emailFrom(),
      to: [input.to],
      subject: input.subject,
      text: input.text,
      html: input.html,
    }),
  });

  const body = (await res.json().catch(() => ({}))) as {
    id?: string;
    message?: string;
    error?: { message?: string };
  };

  if (!res.ok) {
    return {
      ok: false,
      mode: "resend",
      error:
        body.error?.message ||
        body.message ||
        `Resend HTTP ${res.status}`,
    };
  }

  return { ok: true, mode: "resend", messageId: body.id };
}

async function sendViaSmtp(input: {
  to: string;
  subject: string;
  text: string;
  html: string;
}): Promise<EmailSendResult> {
  const host = process.env.SMTP_HOST?.trim();
  const user = process.env.SMTP_USER?.trim();
  const pass = process.env.SMTP_PASS?.trim();
  if (!host || !user || !pass) {
    return {
      ok: false,
      mode: "smtp",
      error: "SMTP_HOST / SMTP_USER / SMTP_PASS incomplete",
    };
  }

  const port = Number(process.env.SMTP_PORT || "587");
  const secure =
    process.env.SMTP_SECURE === "1" ||
    process.env.SMTP_SECURE === "true" ||
    port === 465;

  const nodemailer = await import("nodemailer");
  const transporter = nodemailer.createTransport({
    host,
    port,
    secure,
    auth: { user, pass },
  });

  const info = await transporter.sendMail({
    from: emailFrom(),
    to: input.to,
    subject: input.subject,
    text: input.text,
    html: input.html,
  });

  return {
    ok: true,
    mode: "smtp",
    messageId: typeof info.messageId === "string" ? info.messageId : undefined,
  };
}

function logEmail(input: {
  to: string;
  subject: string;
  text: string;
}): EmailSendResult {
  console.info(
    "[impi-email:mock]",
    JSON.stringify({
      to: input.to,
      subject: input.subject,
      text: input.text.slice(0, 500),
      at: new Date().toISOString(),
    }),
  );
  return { ok: true, mode: "log" };
}

/**
 * Prefer Resend, then SMTP. Without credentials, log the payload (local/mock).
 */
export async function sendAlertEmail(input: {
  to: string;
  subject: string;
  text: string;
  html?: string;
}): Promise<EmailSendResult> {
  const to = input.to.trim();
  if (!to) return { ok: false, mode: "log", skipped: "no_destination" };
  if (!isValidEmail(to)) {
    return { ok: false, mode: "log", error: "Invalid destination email" };
  }

  const subject = input.subject.trim();
  const text = input.text.trim();
  if (!subject || !text) {
    return { ok: false, mode: "log", skipped: "empty" };
  }

  const html =
    input.html?.trim() ||
    `<pre style="font-family:ui-monospace,monospace;white-space:pre-wrap">${escapeHtml(text)}</pre>`;

  if (process.env.RESEND_API_KEY?.trim()) {
    try {
      return await sendViaResend({ to, subject, text, html });
    } catch (error) {
      return {
        ok: false,
        mode: "resend",
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  if (
    process.env.SMTP_HOST?.trim() &&
    process.env.SMTP_USER?.trim() &&
    process.env.SMTP_PASS?.trim()
  ) {
    try {
      return await sendViaSmtp({ to, subject, text, html });
    } catch (error) {
      return {
        ok: false,
        mode: "smtp",
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  return logEmail({ to, subject, text });
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export async function emailModificationAlerts(
  destination: string | null | undefined,
  notifications: AppNotification[],
): Promise<EmailSendResult | null> {
  const alerts = filterEmailAlerts(notifications);
  if (!alerts.length) return null;

  const to = (destination ?? "").trim();
  if (!to) {
    console.info(
      "[impi-email] skip — no alert email configured for owner",
      alerts.map((a) => a.id),
    );
    return { ok: false, mode: "log", skipped: "no_destination" };
  }

  const subject =
    alerts.length === 1
      ? `IMPI: ${alerts[0].title}`
      : `IMPI: ${alerts.length} cambios en seguimiento`;

  const text = alerts
    .map(
      (n) =>
        `${n.title}\n${n.body}\nExpediente: ${n.expediente}\n${n.createdAt}`,
    )
    .join("\n\n---\n\n");

  const html = `<div style="font-family:system-ui,sans-serif;line-height:1.45">
  <p style="margin:0 0 12px">Cambios detectados en tu cartera IMPI:</p>
  ${alerts
    .map(
      (n) => `<div style="margin:0 0 16px;padding:12px;border:1px solid #ddd;border-radius:8px">
      <strong>${escapeHtml(n.title)}</strong>
      <p style="margin:6px 0">${escapeHtml(n.body)}</p>
      <p style="margin:0;font-size:12px;color:#555">Expediente ${escapeHtml(n.expediente)} · ${escapeHtml(n.createdAt)}</p>
    </div>`,
    )
    .join("")}
</div>`;

  return sendAlertEmail({ to, subject, text, html });
}

export type DailyExpiryEmailHit = {
  expediente: string;
  markName: string;
  classNice?: string;
  expiryDate: string;
};

/** Digest for newly found near-expiry marks from the daily TuGaceta scan. */
export async function emailDailyExpiryDigest(
  destination: string | null | undefined,
  hits: DailyExpiryEmailHit[],
  options?: { daysWindow?: number },
): Promise<EmailSendResult | null> {
  if (!hits.length) return null;

  const to = (destination ?? "").trim();
  if (!to) {
    console.info(
      "[impi-email] skip daily expiry digest — no alert email",
      hits.map((h) => h.expediente),
    );
    return { ok: false, mode: "log", skipped: "no_destination" };
  }

  const days = options?.daysWindow ?? 30;
  const subject =
    hits.length === 1
      ? `IMPI: vence ≤ ${days}d — ${hits[0].markName || hits[0].expediente}`
      : `IMPI: ${hits.length} marcas vencen ≤ ${days} días (escaneo diario)`;

  const text = hits
    .map(
      (h) =>
        `${h.markName || "Sin nombre"}\nExpediente: ${h.expediente}\nClase: ${h.classNice || "—"}\nVigencia: ${h.expiryDate}`,
    )
    .join("\n\n---\n\n");

  const html = `<div style="font-family:system-ui,sans-serif;line-height:1.45">
  <p style="margin:0 0 12px">Nuevos vencimientos ≤ ${days} días detectados por el escaneo diario TuGaceta:</p>
  ${hits
    .map(
      (h) => `<div style="margin:0 0 16px;padding:12px;border:1px solid #ddd;border-radius:8px">
      <strong>${escapeHtml(h.markName || "Sin nombre")}</strong>
      <p style="margin:6px 0;font-size:13px">Expediente ${escapeHtml(h.expediente)} · Clase ${escapeHtml(h.classNice || "—")}</p>
      <p style="margin:0;font-size:12px;color:#555">Vigencia ${escapeHtml(h.expiryDate)}</p>
    </div>`,
    )
    .join("")}
</div>`;

  return sendAlertEmail({ to, subject, text, html });
}
