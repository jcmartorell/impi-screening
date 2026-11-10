import { requireIdentity } from "../../cursor/identity";

export type AppViewer = {
  sub: string;
  /** Portfolio partition key: viewer + host stage. */
  ownerKey: string;
  name: string;
  email: string;
  simulated: boolean;
  stage: "production" | "preview";
};

function privateNoStore(init?: ResponseInit): Headers {
  const headers = new Headers(init?.headers);
  headers.set("Cache-Control", "private, no-store");
  return headers;
}

/** Require a verified Cursor viewer for portfolio routes. */
export async function requireViewer(
  request: Request,
): Promise<AppViewer | Response> {
  const identity = await requireIdentity(request);
  if (identity instanceof Response) {
    const body = await identity.text();
    return new Response(body || JSON.stringify({ error: "unauthorized" }), {
      status: identity.status,
      headers: privateNoStore({
        headers: {
          "Content-Type": identity.headers.get("Content-Type") ?? "application/json",
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
    stage,
  };
}

export function jsonPrivate(data: unknown, init?: ResponseInit): Response {
  return Response.json(data, {
    ...init,
    headers: privateNoStore(init),
  });
}
