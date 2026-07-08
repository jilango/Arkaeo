import type { AiProvider } from './aiProvider';
import { AiError } from './aiProvider';

const API_URL = 'https://api.openai.com/v1/chat/completions';
const MODEL = 'gpt-5.4-nano';
const MAX_TOKENS = 600;
const TIMEOUT_MS = 30_000;

interface OpenAiMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

interface OpenAiResponse {
  choices: Array<{
    message: { content: string };
    finish_reason: string;
  }>;
  error?: { message: string; type: string; code?: string };
}

/**
 * OpenAI chat-completions implementation of `AiProvider`.
 *
 * Uses the built-in `fetch` (available in VS Code's Node ≥ 18 runtime).
 * No extra dependencies required.
 */
export class OpenAIProvider implements AiProvider {
  constructor(private readonly apiKey: string) {}

  async explain(prompt: string): Promise<string> {
    // prompt is expected to be the user-turn content only;
    // callers should pass buildPrompt() output split into system + user.
    // This overload accepts a pre-combined string for simplicity —
    // see the two-argument variant below.
    return this.chat([{ role: 'user', content: prompt }]);
  }

  /**
   * Preferred entry point — takes separate system and user strings so the
   * system prompt is not counted against the visible context by some models.
   */
  async explainWithSystem(system: string, user: string): Promise<string> {
    return this.chat([
      { role: 'system', content: system },
      { role: 'user', content: user },
    ]);
  }

  // ---------------------------------------------------------------------------
  // Private
  // ---------------------------------------------------------------------------

  private async chat(messages: OpenAiMessage[]): Promise<string> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

    let response: Response;
    try {
      response = await fetch(API_URL, {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model: MODEL,
          messages,
          max_tokens: MAX_TOKENS,
          temperature: 0.3,  // low temperature = more precise, less hallucination-prone
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

    const data = (await response.json()) as OpenAiResponse;

    if (!response.ok) {
      throw this.toAiError(response.status, data);
    }

    const text = data.choices?.[0]?.message?.content?.trim();
    if (!text) {
      throw new AiError('OpenAI returned an empty response.', 'unknown');
    }
    return text;
  }

  private toAiError(status: number, data: OpenAiResponse): AiError {
    const msg = data.error?.message ?? `HTTP ${status}`;
    const code = data.error?.code ?? '';

    if (status === 401) return new AiError(`Authentication failed: ${msg}`, 'auth');
    if (status === 429) {
      if (code === 'insufficient_quota') return new AiError(`Quota exceeded: ${msg}`, 'quota');
      return new AiError(`Rate limited: ${msg}`, 'rate_limit');
    }
    if (status === 400 && code === 'context_length_exceeded') {
      return new AiError(`Prompt too long: ${msg}`, 'context_length');
    }
    return new AiError(msg, 'unknown');
  }
}
