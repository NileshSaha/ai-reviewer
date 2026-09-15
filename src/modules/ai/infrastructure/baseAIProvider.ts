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
        const parsed = this.parseResponse(data);
        return {
          ...parsed,
          provider: parsed.provider || this.nameValue,
        };
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
      // 1. Strip reasoning/thinking tags emitted by reasoning models (e.g. <think>...</think>, <thought>...</thought>, <reasoning>...</reasoning>)
      let cleaned = (content || '')
        .replace(/<think>[\s\S]*?<\/think>/gi, '')
        .replace(/<thought>[\s\S]*?<\/thought>/gi, '')
        .replace(/<reasoning>[\s\S]*?<\/reasoning>/gi, '')
        .trim();

      // 1b. If unclosed reasoning tags remain, strip up to the first '{' if one exists
      if (/<think>|<thought>|<reasoning>/i.test(cleaned)) {
        const firstBrace = cleaned.indexOf('{');
        if (firstBrace !== -1) {
          cleaned = cleaned.substring(firstBrace);
        } else {
          cleaned = cleaned
            .replace(/<think>[\s\S]*$/gi, '')
            .replace(/<thought>[\s\S]*$/gi, '')
            .replace(/<reasoning>[\s\S]*$/gi, '')
            .trim();
        }
      }

      // 2. Extract JSON code block if wrapped in markdown fences
      const jsonBlockMatch = cleaned.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
      if (jsonBlockMatch && jsonBlockMatch[1]) {
        cleaned = jsonBlockMatch[1].trim();
      } else {
        // Handle unclosed markdown fence (e.g. ```json { ... } without closing ```)
        const unclosedFenceMatch = cleaned.match(/```(?:json)?\s*([\s\S]*)/i);
        if (unclosedFenceMatch && unclosedFenceMatch[1] && unclosedFenceMatch[1].includes('{')) {
          cleaned = unclosedFenceMatch[1].trim();
        }

        // 3. Extract the outermost JSON object if surrounding text exists
        const firstBrace = cleaned.indexOf('{');
        const lastBrace = cleaned.lastIndexOf('}');
        if (firstBrace !== -1 && lastBrace > firstBrace) {
          cleaned = cleaned.substring(firstBrace, lastBrace + 1).trim();
        }
      }

      if (!cleaned) {
        cleaned = content
          .replace(/^```json\n?/i, '')
          .replace(/^```\n?/, '')
          .replace(/```$/, '')
          .trim();
      }

      // 4. Sanitize minor JSON syntax issues: trailing commas before } or ]
      const sanitized = cleaned.replace(/,\s*([}\]])/g, '$1');

      let parsed: any;
      try {
        parsed = JSON.parse(sanitized);
      } catch {
        try {
          parsed = JSON.parse(cleaned);
        } catch {
          parsed = this.repairAndParseJson(cleaned);
        }
      }

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

      // Clean content for fallback: remove thinking tags, markdown fences, etc.
      const cleanContent = (content || '')
        .replace(/<think>[\s\S]*?<\/think>/gi, '')
        .replace(/<thought>[\s\S]*?<\/thought>/gi, '')
        .replace(/<reasoning>[\s\S]*?<\/reasoning>/gi, '')
        .replace(/<think>[\s\S]*$/gi, '')
        .replace(/<thought>[\s\S]*$/gi, '')
        .replace(/<reasoning>[\s\S]*$/gi, '')
        .replace(/```(?:json)?/gi, '')
        .replace(/```/g, '')
        .trim();

      const summaryText = cleanContent
        ? cleanContent.substring(0, 500)
        : 'Automated review completed. Please review pull request changes.';

      return {
        score: 50,
        summary: summaryText,
        verdict: 'REQUEST_CHANGES',
        strengths: [],
        issues: [],
        security: null,
        performance: null,
        comments: [],
        overallComment: '',
      };
    }
  }

  private repairJson(json: string): string {
    let cleaned = json.trim();
    if (!cleaned.startsWith('{') && !cleaned.startsWith('[')) {
      return cleaned;
    }

    const stack: ('{' | '[')[] = [];
    let inString = false;
    let escaped = false;

    for (let i = 0; i < cleaned.length; i++) {
      const char = cleaned[i];
      if (inString) {
        if (escaped) {
          escaped = false;
        } else if (char === '\\') {
          escaped = true;
        } else if (char === '"') {
          inString = false;
        }
      } else {
        if (char === '"') {
          inString = true;
        } else if (char === '{') {
          stack.push('{');
        } else if (char === '[') {
          stack.push('[');
        } else if (char === '}') {
          if (stack.length > 0 && stack[stack.length - 1] === '{') {
            stack.pop();
          }
        } else if (char === ']') {
          if (stack.length > 0 && stack[stack.length - 1] === '[') {
            stack.pop();
          }
        }
      }
    }

    let repaired = cleaned;
    if (inString) {
      repaired += '"';
    }

    // Iteratively clean trailing invalid syntax before closing braces
    let cleanRep = repaired.trim();
    let changed = true;
    while (changed) {
      changed = false;
      if (/:$/.test(cleanRep)) {
        cleanRep = cleanRep.slice(0, -1).trim();
        changed = true;
      }
      if (/,$/.test(cleanRep)) {
        cleanRep = cleanRep.slice(0, -1).trim();
        changed = true;
      }
    }

    // Append matching closing structures
    for (let i = stack.length - 1; i >= 0; i--) {
      const open = stack[i];
      if (open === '{') {
        cleanRep += '}';
      } else if (open === '[') {
        cleanRep += ']';
      }
    }

    return cleanRep;
  }

  private repairAndParseJson(jsonString: string): any {
    let cleaned = jsonString.trim();
    const firstBrace = cleaned.indexOf('{');
    if (firstBrace !== -1) {
      cleaned = cleaned.substring(firstBrace).trim();
    }

    // 1. Try to repair the entire string and parse it
    try {
      const repaired = this.repairJson(cleaned);
      const sanitized = repaired.replace(/,\s*([}\]])/g, '$1');
      return JSON.parse(sanitized);
    } catch {
      // Repair failed or JSON.parse failed. Let's backtrack using safe delimiters!
    }

    // Identify safe delimiter indices (indices of delimiters outside string literals)
    const safeDelimiterIndices: number[] = [];
    let inString = false;
    let escaped = false;
    const stack: ('{' | '[')[] = [];

    for (let i = 0; i < cleaned.length; i++) {
      const char = cleaned[i];
      if (inString) {
        if (escaped) {
          escaped = false;
        } else if (char === '\\') {
          escaped = true;
        } else if (char === '"') {
          inString = false;
        }
      } else {
        if (char === '"') {
          inString = true;
        } else if (char === '{') {
          stack.push('{');
          safeDelimiterIndices.push(i);
        } else if (char === '[') {
          stack.push('[');
          safeDelimiterIndices.push(i);
        } else if (char === '}') {
          if (stack.length > 0 && stack[stack.length - 1] === '{') {
            stack.pop();
          }
          safeDelimiterIndices.push(i);
        } else if (char === ']') {
          if (stack.length > 0 && stack[stack.length - 1] === '[') {
            stack.pop();
          }
          safeDelimiterIndices.push(i);
        } else if (char === ',') {
          safeDelimiterIndices.push(i);
        }
      }
    }

    // Backtrack backwards through safe delimiters and attempt sliced repairs
    for (let k = safeDelimiterIndices.length - 1; k >= 0; k--) {
      const delimiterIndex = safeDelimiterIndices[k];
      const sliced = cleaned.substring(0, delimiterIndex).trim();
      if (!sliced) continue;

      try {
        const repaired = this.repairJson(sliced);
        const sanitized = repaired.replace(/,\s*([}\]])/g, '$1');
        return JSON.parse(sanitized);
      } catch {
        // Keep backtracking
      }
    }

    throw new Error('Could not repair and parse truncated JSON');
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}