/**
 * A page outside the app (plan S2-1 Task 9): the store's listing for the update banner's first button, the scoring
 * link in the browser for its second. One call, whose answer is whether the phone took it; it carries no session state
 * and is never read by the engine.
 *
 * The browser's URL holds the scoring link's token: the port's callers and implementations never log it.
 */
export interface LinkPort {
  /** Resolves once the phone has handed the URL to the app that opens it; rejects when nothing can open it. */
  openUrl(url: string): Promise<void>;
}
