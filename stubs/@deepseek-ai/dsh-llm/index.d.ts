/**
 * Typecheck stubs for @deepseek-ai/dsh-llm (0.2.0-rc.2) — the subset of the
 * real LLM seam dsh-custom-header uses as a native `LlmAdapter`: the adapter
 * base class, the stream chunk vocabulary, request options, and the
 * attribution helper. Declarations only; never shipped. The real package
 * provides the full surface at load time.
 */

/** Adapter iteration options (sessionId scopes per-conversation ids natively). */
export interface GenerateOptions {
  provider: string
  model: string
  messages: readonly Message[]
  system?: string
  maxTokens?: number
  temperature?: number
  stop?: string | string[]
  tools?: readonly Tool[]
  sessionId?: string | number
  purpose?: string
  reasoningEffort?: string
  signal?: AbortSignal
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [key: string]: any
}

/** A tool the model may call. */
export interface Tool {
  name: string
  description?: string
  parameters: unknown
  deferLoading?: boolean
}

/** Branded tool-call id (string carried as JSON on the wire). */
export type ToolCallId = string & { readonly __toolCallId?: never }

export type ContentBlockType =
  | 'text'
  | 'reasoning'
  | 'image'
  | 'file'
  | 'tool-call'
  | 'tool-addition'
  | 'tool-removal'

export interface TextBlock {
  type: 'text'
  text: string
}

export interface ReasoningBlock {
  type: 'reasoning'
  text: string
}

export interface ToolCallBlock {
  type: 'tool-call'
  id: ToolCallId
  name: string
  arguments: string
}

export interface ImageBlock {
  type: 'image'
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [key: string]: any
}

export type ContentBlock = TextBlock | ReasoningBlock | ToolCallBlock | ImageBlock | {
  type: string
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [key: string]: any
}

/** One conversation message as the LLM seam hands it to an adapter. */
export interface Message {
  role: 'user' | 'assistant' | 'system' | 'developer' | 'tool'
  content: readonly ContentBlock[]
  toolCallId?: ToolCallId
  isError?: boolean
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [key: string]: any
}

export interface LlmFailure {
  readonly message: string
  readonly code: string
  readonly status?: number
  readonly providerRetryAfterMs?: number
  readonly requestId?: string
  readonly offloadImages?: number
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [key: string]: any
}

export type FinishReason =
  | { kind: 'stop' }
  | { kind: 'tool-calls' }
  | { kind: 'max-tokens' }
  | { kind: 'aborted'; failure: LlmFailure }
  | { kind: 'error'; failure: LlmFailure }

export interface TokenUsage {
  inputTokens: number
  outputTokens: number
  totalTokens?: number
  cacheReadTokens?: number
  cacheWriteTokens?: number
  reasoningTokens?: number
}

/** Normalized stream chunk emitted by an adapter iteration. */
export type StreamChunk =
  | { type: 'block-start'; index: number; blockType: ContentBlockType }
  | { type: 'text-delta'; index: number; text: string }
  | { type: 'reasoning-delta'; index: number; text: string }
  | { type: 'tool-call-delta'; index: number; id: ToolCallId; name?: string; argumentsDelta: string }
  | { type: 'block-end'; index: number; block: ContentBlock }
  | { type: 'usage'; usage: TokenUsage }
  | { type: 'finish'; reason: FinishReason; replayState?: unknown }

/** The prepared-call return: one model identity + one-generation stream. */
export interface PreparedCall {
  model: unknown
  stream: (options: GenerateOptions) => AsyncIterable<StreamChunk>
}

/**
 * Provider-wire adapter for the harness message and stream vocabulary.
 * Register implementations with `ctx.llm.registerAdapter(providers, adapter)`.
 */
export class LlmAdapter {
  providerInfo(provider: string): { id: string; name: string }
  providerRetryPolicy(_provider: string): unknown
  imageRequestPricing(_provider: string, _model: string): unknown
  listModels(_provider: string): Promise<unknown[]>
  resolveModel(provider: string, model: string, _signal?: AbortSignal): Promise<unknown>
  prepareCall(provider: string, model: string, signal?: AbortSignal): Promise<PreparedCall>
  stream(options: GenerateOptions): AsyncIterable<StreamChunk>
}

export class LlmError extends Error {
  constructor(message: string, code: string, extra?: Record<string, unknown>)
  readonly code: string
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [key: string]: any
}

export interface AppIdentity {
  product: string
  version: string
  url: string
}

/** The harness's mandatory attribution identity (lowercase header names). */
export function attributionHeaders(identity?: AppIdentity): { 'user-agent': string }
export function userAgent(identity?: AppIdentity): string
export const APP_IDENTITY: AppIdentity