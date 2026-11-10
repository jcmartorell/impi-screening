import { getIdentity, requireIdentity } from "../../cursor/identity";
import { DEV_VIEWER } from "../../cursor/identity.dev";
import { DEV_OWNER_KEY } from "@/lib/seed";

export type AppViewer = {
  sub: string;
  /** Portfolio partition key: viewer + host stage. */
  ownerKey: string;
  name: string;
  email: string;
  simulated: boolean;
  /** True when anonymous Vercel/demo host fell back without Cursor sign-in. */
  demoMode: boolean;
  stage: "production" | "preview";
};

function privateNoStore(init?: ResponseInit): Headers {
  const headers = new Headers(init?.headers);
  headers.set("Cache-Control", "private, no-store");
  return headers;
}

function cursorAppIdSet(): boolean {
  const id = process.env.CURSOR_APP_ID;
  return typeof id === "string" && id.trim() !== "";
}

/** Demo viewer aligned with seed partition `user:dev::production`. */
function demoViewer(): AppViewer {
  const [sub] = DEV_OWNER_KEY.split("::");
  return {
    sub,
    ownerKey: DEV_OWNER_KEY,
    name: DEV_VIEWER?.name ?? "Demo Viewer",
    email: DEV_VIEWER?.email ?? "demo@example.com",
    simulated: true,
    demoMode: true,
    stage: "production",
  };
}

/**
 * Resolve a portfolio viewer.
 * - Cursor-hosted (`CURSOR_APP_ID` set): verified identity only.
 * - Anonymous/demo hosts (no `CURSOR_APP_ID`): fall back to seed demo viewer
 *   when the identity header is missing/unverified so Vercel previews work.
 */
export async function resolveViewer(
  request: Parameters<typeof getIdentity>[0],
): Promise<AppViewer | null> {
  const identity = await getIdentity(request);
  if (identity.verified) {
    const stage = identity.stage === "preview" ? "preview" : "production";
    return {
      sub: identity.sub,
      ownerKey: `${identity.sub}::${stage}`,
      name: identity.name,
      email: identity.email,
      simulated: Boolean(identity.simulated),
      demoMode: false,
      stage,
    };
  }

  // Published Cursor apps must never bypass the gate.
  if (cursorAppIdSet()) {
    return null;
  }

  // Anonymous Vercel / local-without-header: show seed cartera in demo mode.
  // Covers missing_header and any other unverified reason when CURSOR_APP_ID is unset.
  return demoViewer();
}

/** Require a verified Cursor viewer for portfolio routes (APIs). */
export async function requireViewer(
  request: Request,
): Promise<AppViewer | Response> {
  if (cursorAppIdSet()) {
    const identity = await requireIdentity(request);
    if (identity instanceof Response) {
      const body = await identity.text();
      return new Response(body || JSON.stringify({ error: "unauthorized" }), {
        status: identity.status,
        headers: privateNoStore({
          headers: {
            "Content-Type":
              identity.headers.get("Content-Type") ?? "application/json",
          },
        }),
      });
    }

    const stage = identity.stage === "preview" ? "preview" : "production";
    return {
      sub: identity.sub,
      ownerKey: `${identity.sub}::${stage}`,
      name: identity.name,
      email: identity.email,
      simulated: Boolean(identity.simulated),
      demoMode: false,
      stage,
    };
  }

  const viewer = await resolveViewer(request);
  if (!viewer) {
    return new Response(JSON.stringify({ error: "unauthorized" }), {
      status: 401,
      headers: privateNoStore({
        headers: { "Content-Type": "application/json" },
      }),
    });
  }
  return viewer;
}

export function jsonPrivate(data: unknown, init?: ResponseInit): Response {
  return Response.json(data, {
    ...init,
    headers: privateNoStore(init),
  });
}
