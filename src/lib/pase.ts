/**
 * PASE layer stub.
 *
 * Authenticated IMPI PASE login and official notifications require credentials
 * and are intentionally out of scope for v1. Keep this module as the seam for
 * a future Slack/email/PASE notifier without coupling the public scraper path.
 */

export interface PaseCredentials {
  username: string;
  password: string;
}

export async function loginPase(_credentials?: PaseCredentials): Promise<{
  ok: false;
  status: "stub";
  message: string;
}> {
  return {
    ok: false,
    status: "stub",
    message:
      "PASE authenticated session is not configured. Provide credentials in a later release.",
  };
}

export async function pullPaseNotifications(_sessionToken?: string): Promise<{
  ok: false;
  items: [];
  message: string;
}> {
  return {
    ok: false,
    items: [],
    message: "PASE notification pull is stubbed for v1.",
  };
}
