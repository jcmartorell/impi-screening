import {
  buildPortfolioSetCookie,
  hydrateStoreFromCookie,
  parsePortfolioCookieValue,
  readPortfolioCookieFromRequest,
  type PortfolioCookieState,
} from "@/lib/portfolio-cookie";

export {
  DEFAULT_ALERT_EMAIL,
  PORTFOLIO_COOKIE,
  resolveAlertEmail,
} from "@/lib/portfolio-cookie";

/** Hydrate SQLite from the durable portfolio cookie on this request. */
export function hydratePortfolioForRequest(
  ownerKey: string,
  request: Request,
): PortfolioCookieState | null {
  const state = readPortfolioCookieFromRequest(request);
  hydrateStoreFromCookie(ownerKey, state);
  return state;
}

/** Hydrate from Next `cookies().get` value (RSC page). */
export function hydratePortfolioFromCookieValue(
  ownerKey: string,
  raw: string | undefined,
): PortfolioCookieState | null {
  const state = parsePortfolioCookieValue(raw);
  hydrateStoreFromCookie(ownerKey, state);
  return state;
}

export function portfolioSetCookie(ownerKey: string): string {
  return buildPortfolioSetCookie(ownerKey);
}
