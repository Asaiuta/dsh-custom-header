/**
 * Typecheck stubs for @deepseek-ai/cordis — the subset of the real Cordis
 * surface dsh-custom-header uses. Declarations only; never shipped.
 */

export interface Context {
  /** Emit/listen for an event on this context. */
  on(event: string, listener: (...args: any[]) => unknown): void
  /** Register a lifecycle effect; returns a disposer or void. */
  effect(fn: () => void | Promise<void> | (() => void) | Promise<(() => void)>, label?: string): void
  /** Provide a service under a key. */
  provide(name: string, service: unknown): void
  /** Resolve a provided service by name. */
  get(name: string): unknown
  /** The fiber's logger. Real Cordis stringifies whatever it is handed. */
  readonly logger: { info(...args: unknown[]): void; warn(...args: unknown[]): void; error(...args: unknown[]): void }
  readonly fiber?: { state: number; uid?: number; runtime?: unknown }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [key: string]: any
}