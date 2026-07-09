/**
 * Abstraction over the AI back-end used for Engineering Summary.
 */
export interface AiProvider {
  /**
   * Generates a natural-language explanation for the given prompt.
   * Resolves with the full response text.
   *
   * Throws `AiError` on network failure, auth failure, or rate-limiting.
   */
  explain(prompt: string): Promise<string>;
}

export class AiError extends Error {
  constructor(
    message: string,
    public readonly code:
      | 'auth'           // 401 — bad/missing API key
      | 'rate_limit'     // 429 — too many requests
      | 'quota'          // 429/402 — billing quota exceeded
      | 'context_length' // 400 — prompt too long
      | 'network'        // fetch failed, timeout
      | 'unknown',
  ) {
    super(message);
    this.name = 'AiError';
  }
}
