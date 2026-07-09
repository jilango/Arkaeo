import type { AiProvider } from './aiProvider';
import { AiError } from './aiProvider';

const API_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';
const MODEL = 'claude-haiku-4-5';
const MAX_TOKENS = 600;
const TIMEOUT_MS = 30_000;

interface AnthropicResponse {
  content: Array<{ type: string; text: string }>;
  error?: { type: string; message: string };
}

/**
 * Anthropic Messages API implementation of `AiProvider`.
 */
export class AnthropicProvider implements AiProvider {
  constructor(private readonly apiKey: string) {}

  async explain(prompt: string): Promise<string> {
    return this.request(undefined, prompt);
  }

  /**
   * Preferred entry point — Anthropic's API accepts system as a dedicated
   * top-level field, which is the idiomatic way to pass a system prompt.
   */
  async explainWithSystem(system: string, user: string): Promise<string> {
    return this.request(system, user);
  }

  // ---------------------------------------------------------------------------
  // Private
  // ---------------------------------------------------------------------------

  private async request(system: string | undefined, userContent: string): Promise<string> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

    let response: Response;
    try {
      response = await fetch(API_URL, {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': this.apiKey,
          'anthropic-version': ANTHROPIC_VERSION,
        },
        body: JSON.stringify({
          model: MODEL,
          max_tokens: MAX_TOKENS,
          ...(system ? { system } : {}),
          messages: [{ role: 'user', content: userContent }],
        }),
      });
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        throw new AiError('Request timed out after 30 seconds.', 'network');
      }
      throw new AiError(
        `Network error: ${err instanceof Error ? err.message : String(err)}`,
        'network',
      );
    } finally {
      clearTimeout(timer);
    }

    const data = (await response.json()) as AnthropicResponse;

    if (!response.ok) {
      throw this.toAiError(response.status, data);
    }

    const text = data.content?.find((b) => b.type === 'text')?.text?.trim();
    if (!text) {
      throw new AiError('Anthropic returned an empty response.', 'unknown');
    }
    return text;
  }

  private toAiError(status: number, data: AnthropicResponse): AiError {
    const msg = data.error?.message ?? `HTTP ${status}`;
    const type = data.error?.type ?? '';

    if (status === 401) return new AiError(`Authentication failed: ${msg}`, 'auth');
    if (status === 429) return new AiError(`Rate limited: ${msg}`, 'rate_limit');
    if (status === 400 && type === 'invalid_request_error') {
      if (msg.includes('token')) return new AiError(`Prompt too long: ${msg}`, 'context_length');
    }
    if (status === 529) return new AiError(`Anthropic API overloaded: ${msg}`, 'rate_limit');
    return new AiError(msg, 'unknown');
  }
}
