import { AIReviewResult, PRDetails, DiffContent, ReviewDecision, IssueSeverity } from '../application/aiTypes';
import { Logger } from '../../../shared/types/logger';
import { AIProviderError } from '../../../shared/types/errors';
import { DEFAULT_TOKEN_BUDGET, ReviewOptions, TokenBudget } from '../application/aiProvider';

export type AIResponse = AIReviewResult;

export interface BaseAIProviderOptions {
  maxPromptTokens?: number;
  maxResponseTokens?: number;
  maxPatchCharsPerFile?: number;
  charsPerToken?: number;
}

export abstract class BaseAIProvider {
  protected abstract nameValue: string;
  protected abstract endpoint: string;
  protected model: string;
  protected logger: Logger;
  protected maxPromptTokens!: number;
  protected maxResponseTokens!: number;
  protected maxPatchCharsPerFile!: number;
  protected charsPerToken!: number;

  constructor(protected apiKey: string, logger: Logger, model?: string) {
    this.logger = logger;
    this.model = model ?? '';
  }

  protected applyOptions(opts: BaseAIProviderOptions): void {
    this.maxPromptTokens = opts.maxPromptTokens ?? DEFAULT_TOKEN_BUDGET.maxPromptTokens;
    this.maxResponseTokens = opts.maxResponseTokens ?? DEFAULT_TOKEN_BUDGET.maxResponseTokens;
    this.maxPatchCharsPerFile = opts.maxPatchCharsPerFile ?? 1500;
    this.charsPerToken = opts.charsPerToken ?? DEFAULT_TOKEN_BUDGET.charsPerToken;
  }

  abstract buildRequestBody(prompt: string, maxResponseTokens?: number): object;

  abstract parseResponse(response: any): AIReviewResult;

  name(): string {
    return this.nameValue;
  }

  async validateApiKey(): Promise<{ valid: boolean; error?: string }> {
    try {
      const response = await fetch(this.endpoint, {
        method: 'POST',
        headers: this.buildHeaders(),
        body: JSON.stringify(this.buildPingRequestBody()),
      });

      if (response.ok) {
        return { valid: true };
      }

      if (response.status === 401 || response.status === 403) {
        const text = await response.text().catch(() => '');
        return { valid: false, error: `Auth failed (${response.status}): ${text.slice(0, 200)}` };
      }

      if (response.status === 429) {
        return { valid: false, error: 'Rate limited (429)' };
      }

      const text = await response.text().catch(() => '');
      return { valid: false, error: `HTTP ${response.status}: ${text.slice(0, 200)}` };
    } catch (error) {
      return {
        valid: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  protected buildPingRequestBody(): object {
    return {
      model: this.model,
      messages: [
        {
          role: 'user',
          content: 'Respond with valid JSON only: {"ok": true}',
        },
      ],
      max_tokens: 16,
    };
  }

  async generateReview(
    pr: PRDetails,
    diff: DiffContent,
    options?: ReviewOptions
  ): Promise<AIReviewResult> {
    const { buildReviewPromptDetailed } = require('../application/promptBuilder');
    const budget = options?.tokenBudget ?? {
      maxPromptTokens: this.maxPromptTokens,
      maxResponseTokens: this.maxResponseTokens,
      charsPerToken: this.charsPerToken,
    };
    const shrinkFactor = options?.shrinkFactor ?? 0.5;
    const retryOnRateLimit = options?.retryOnRateLimit ?? true;

    let currentBudget: TokenBudget = { ...budget };
    let attempt = 0;
    const maxAttempts = retryOnRateLimit ? 2 : 1;

    while (attempt < maxAttempts) {
      attempt++;
      const maxPromptChars = currentBudget.maxPromptTokens * currentBudget.charsPerToken;

      const { prompt, fit } = buildReviewPromptDetailed(pr, diff, {
        maxPromptChars,
        maxPatchCharsPerFile: this.maxPatchCharsPerFile,
      });

      this.logger.debug(`Generating review with ${this.nameValue} (attempt ${attempt})`, {
        repository: pr.repository,
        pr_number: pr.prNumber,
        prompt_chars: fit.totalChars,
        truncated_files: fit.truncatedCount,
        omitted_files: fit.droppedCount,
      });

      try {
        const response = await fetch(this.endpoint, {
          method: 'POST',
          headers: this.buildHeaders(),
          body: JSON.stringify(this.buildRequestBody(prompt, currentBudget.maxResponseTokens)),
        });

        if (response.status === 413 || response.status === 429) {
          const retryAfter = this.parseRetryAfter(response);
          const errorText = await response.text();
          this.logger.warn(`AI provider returned ${response.status}; shrinking budget`, {
            provider: this.nameValue,
            attempt,
            retry_after_seconds: retryAfter,
            current_budget_tokens: currentBudget.maxPromptTokens,
          });

          if (attempt < maxAttempts) {
            currentBudget = {
              ...currentBudget,
              maxPromptTokens: Math.max(500, Math.floor(currentBudget.maxPromptTokens * shrinkFactor)),
              maxResponseTokens: Math.max(200, Math.floor(currentBudget.maxResponseTokens * shrinkFactor)),
            };
            const waitMs = (retryAfter ?? 5) * 1000;
            await sleep(waitMs);
            continue;
          }

          throw new AIProviderError(
            `${this.nameValue} API error: ${response.status} - ${errorText}`,
            this.nameValue,
            false
          );
        }

        if (!response.ok) {
          const errorText = await response.text();
          throw new AIProviderError(
            `${this.nameValue} API error: ${response.status} - ${errorText}`,
            this.nameValue,
            this.isRetryableStatus(response.status)
          );
        }

        const data = await response.json();
        return this.parseResponse(data);
      } catch (error) {
        if (error instanceof AIProviderError) {
          throw error;
        }
        if (attempt < maxAttempts) {
          this.logger.warn(`AI provider call threw, retrying with smaller budget`, {
            provider: this.nameValue,
            attempt,
            error: error instanceof Error ? error.message : String(error),
          });
          currentBudget = {
            ...currentBudget,
            maxPromptTokens: Math.max(500, Math.floor(currentBudget.maxPromptTokens * shrinkFactor)),
            maxResponseTokens: Math.max(200, Math.floor(currentBudget.maxResponseTokens * shrinkFactor)),
          };
          continue;
        }
        throw new AIProviderError(
          `Failed to generate review: ${error instanceof Error ? error.message : String(error)}`,
          this.nameValue,
          true
        );
      }
    }

    throw new AIProviderError(
      `Exhausted retries for ${this.nameValue}`,
      this.nameValue,
      false
    );
  }

  protected buildHeaders(): Record<string, string> {
    return {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${this.apiKey}`,
    };
  }

  protected isRetryableStatus(status: number): boolean {
    return [429, 500, 502, 503, 504].includes(status);
  }

  protected parseRetryAfter(response: Response): number | null {
    const header = response.headers.get('retry-after');
    if (!header) return null;
    const seconds = parseInt(header, 10);
    if (isNaN(seconds)) return null;
    return Math.max(0, seconds);
  }

  protected normalizeScore(value: any): number {
    const num = Number(value);
    if (isNaN(num)) return 50;
    return Math.min(100, Math.max(0, num));
  }

  protected parseAIReviewResponse(content: string): AIReviewResult {
    try {
      const cleaned = content
        .replace(/^```json\n?/i, '')
        .replace(/^```\n?/, '')
        .replace(/```$/, '')
        .trim();
      const parsed = JSON.parse(cleaned);

      const verdict: ReviewDecision = parsed.verdict === 'REQUEST_CHANGES' ? 'REQUEST_CHANGES' : 'APPROVE';
      const score = this.normalizeScore(parsed.score);
      const summary = String(parsed.summary || 'No summary provided');

      const strengths: string[] = Array.isArray(parsed.strengths)
        ? parsed.strengths.filter((s: any) => s).map(String)
        : [];

      const issues = Array.isArray(parsed.issues)
        ? parsed.issues.map((i: any) => ({
            severity: ['critical', 'major', 'minor'].includes(i.severity)
              ? (i.severity as IssueSeverity)
              : ('minor' as IssueSeverity),
            file: String(i.file || ''),
            line: Number(i.line) || undefined,
            description: String(i.description || ''),
            suggestion: i.suggestion ? String(i.suggestion) : undefined,
          }))
        : [];

      const security = parsed.security !== undefined && parsed.security !== null
        ? String(parsed.security)
        : null;

      const performance = parsed.performance !== undefined && parsed.performance !== null
        ? String(parsed.performance)
        : null;

      const comments = Array.isArray(parsed.comments)
        ? parsed.comments.map((c: any) => ({
            file: String(c.file || ''),
            line: Number(c.line) || 0,
            text: String(c.text || ''),
          }))
        : [];

      const overallComment = parsed.overallComment
        ? String(parsed.overallComment)
        : '';

      this.logger.debug('Parsed AI review response', {
        score,
        verdict,
        strengths_count: strengths.length,
        issues_count: issues.length,
        comments_count: comments.length,
        has_security_concern: security !== null,
        has_perf_concern: performance !== null,
      });

      return { score, summary, verdict, strengths, issues, security, performance, comments, overallComment };
    } catch {
      this.logger.warn('Failed to parse AI response as JSON, using raw text fallback', { content });
      return {
        score: 50,
        summary: content.substring(0, 500),
        verdict: 'REQUEST_CHANGES',
        strengths: [],
        issues: [],
        security: null,
        performance: null,
        comments: [],
        overallComment: content.substring(0, 2000),
      };
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}