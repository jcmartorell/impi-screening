/** Optional peer — present when `playwright` is installed for worker mode. */
declare module "playwright" {
  export const chromium: {
    launch: (options?: {
      headless?: boolean;
      args?: string[];
    }) => Promise<{
      newPage: () => Promise<{
        goto: (
          url: string,
          options?: { waitUntil?: string; timeout?: number },
        ) => Promise<unknown>;
        waitForFunction: (
          fn: () => boolean,
          options?: { timeout?: number },
        ) => Promise<unknown>;
        evaluate: <T>(
          fn: (arg: unknown) => T | Promise<T>,
          arg?: unknown,
        ) => Promise<T>;
      }>;
      close: () => Promise<void>;
    }>;
  };
}
