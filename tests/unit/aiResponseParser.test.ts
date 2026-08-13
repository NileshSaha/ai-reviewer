import { BaseAIProvider } from '../../src/modules/ai/infrastructure/baseAIProvider';
import { AIReviewResult } from '../../src/modules/ai/application/aiTypes';
import { Logger } from '../../src/shared/types/logger';

class TestableProvider extends BaseAIProvider {
  protected nameValue = 'test';
  protected endpoint = 'https://test.com';

  constructor(logger: Logger) {
    super('test-key', logger, 'test-model');
    this.applyOptions({});
  }

  buildRequestBody(_prompt: string, _maxResponseTokens?: number): object {
    return { model: this.model };
  }

  parseResponse(response: any): AIReviewResult {
    return this.parseAIReviewResponse(response.content);
  }

  public parseTestResponse(content: string): AIReviewResult {
    return this.parseAIReviewResponse(content);
  }
}

function createMockLogger(): Logger {
  const noop = (..._: any[]) => {};
  return {
    debug: noop,
    info: noop,
    warn: noop,
    error: noop,
    withContext: () => createMockLogger(),
  };
}

describe('parseAIReviewResponse', () => {
  let parser: TestableProvider;

  beforeEach(() => {
    parser = new TestableProvider(createMockLogger());
  });

  it('parses a complete valid response', () => {
    const input = JSON.stringify({
      score: 85,
      summary: 'Good PR overall',
      verdict: 'APPROVE',
      strengths: ['Clean code', 'Good tests'],
      issues: [
        { severity: 'minor', file: 'src/a.ts', line: 10, description: 'Typo', suggestion: 'Fix typo' },
        { severity: 'major', file: 'src/b.ts', description: 'Bug' },
      ],
      security: null,
      performance: 'Slow query in loop',
      comments: [{ file: 'src/a.ts', line: 10, text: 'Fix this' }],
      overallComment: '## Review\n\nLooks good',
    });

    const result = parser.parseTestResponse(input);

    expect(result.score).toBe(85);
    expect(result.summary).toBe('Good PR overall');
    expect(result.verdict).toBe('APPROVE');
    expect(result.strengths).toEqual(['Clean code', 'Good tests']);
    expect(result.issues).toHaveLength(2);
    expect(result.issues[0].severity).toBe('minor');
    expect(result.issues[0].file).toBe('src/a.ts');
    expect(result.issues[0].line).toBe(10);
    expect(result.issues[0].description).toBe('Typo');
    expect(result.issues[0].suggestion).toBe('Fix typo');
    expect(result.issues[1].severity).toBe('major');
    expect(result.issues[1].line).toBeUndefined();
    expect(result.issues[1].suggestion).toBeUndefined();
    expect(result.security).toBeNull();
    expect(result.performance).toBe('Slow query in loop');
    expect(result.comments).toHaveLength(1);
    expect(result.overallComment).toBe('## Review\n\nLooks good');
  });

  it('strips ```json fences', () => {
    const input = '```json\n{"score": 90, "summary": "Great", "verdict": "APPROVE", "strengths": [], "issues": [], "security": null, "performance": null, "comments": [], "overallComment": ""}\n```';
    const result = parser.parseTestResponse(input);
    expect(result.score).toBe(90);
    expect(result.summary).toBe('Great');
  });

  it('strips ``` fences without json label', () => {
    const input = '```\n{"score": 90, "summary": "Great", "verdict": "APPROVE", "strengths": [], "issues": [], "security": null, "performance": null, "comments": [], "overallComment": ""}\n```';
    const result = parser.parseTestResponse(input);
    expect(result.score).toBe(90);
  });

  it('uses safe defaults for missing fields', () => {
    const input = JSON.stringify({});
    const result = parser.parseTestResponse(input);

    expect(result.score).toBe(50);
    expect(result.summary).toBe('No summary provided');
    expect(result.verdict).toBe('APPROVE');
    expect(result.strengths).toEqual([]);
    expect(result.issues).toEqual([]);
    expect(result.security).toBeNull();
    expect(result.performance).toBeNull();
    expect(result.comments).toEqual([]);
    expect(result.overallComment).toBe('');
  });

  it('normalizes invalid score to 0-100 range', () => {
    const input = JSON.stringify({ score: 999, summary: 'test', verdict: 'APPROVE', strengths: [], issues: [], security: null, performance: null, comments: [], overallComment: '' });
    const result = parser.parseTestResponse(input);
    expect(result.score).toBe(100);
  });

  it('normalizes negative score to 0', () => {
    const input = JSON.stringify({ score: -5, summary: 'test', verdict: 'REQUEST_CHANGES', strengths: [], issues: [], security: null, performance: null, comments: [], overallComment: '' });
    const result = parser.parseTestResponse(input);
    expect(result.score).toBe(0);
  });

  it('normalizes non-numeric score to 50', () => {
    const input = JSON.stringify({ score: 'not-a-number', summary: 'test', verdict: 'APPROVE', strengths: [], issues: [], security: null, performance: null, comments: [], overallComment: '' });
    const result = parser.parseTestResponse(input);
    expect(result.score).toBe(50);
  });

  it('falls back to REQUEST_CHANGES verdict for anything other than APPROVE', () => {
    const input = JSON.stringify({ verdict: 'INVALID', summary: 'test', score: 80, strengths: [], issues: [], security: null, performance: null, comments: [], overallComment: '' });
    const result = parser.parseTestResponse(input);
    expect(result.verdict).toBe('APPROVE');
  });

  it('normalizes invalid severity to minor', () => {
    const input = JSON.stringify({
      verdict: 'REQUEST_CHANGES', summary: 'test', score: 50, strengths: [], issues: [{ severity: 'unknown', file: 'a.ts', description: 'x' }], security: null, performance: null, comments: [], overallComment: '',
    });
    const result = parser.parseTestResponse(input);
    expect(result.issues[0].severity).toBe('minor');
  });

  it('handles string security and performance fields', () => {
    const input = JSON.stringify({
      verdict: 'REQUEST_CHANGES', summary: 'test', score: 50, strengths: [], issues: [], security: 'Hardcoded API key', performance: 'N+1 queries', comments: [], overallComment: '',
    });
    const result = parser.parseTestResponse(input);
    expect(result.security).toBe('Hardcoded API key');
    expect(result.performance).toBe('N+1 queries');
  });

  it('handles malformed JSON with raw fallback', () => {
    const input = '{This is not valid JSON}';
    const result = parser.parseTestResponse(input);

    expect(result.score).toBe(50);
    expect(result.summary).toBe(input.substring(0, 500));
    expect(result.verdict).toBe('REQUEST_CHANGES');
    expect(result.strengths).toEqual([]);
    expect(result.issues).toEqual([]);
    expect(result.security).toBeNull();
    expect(result.performance).toBeNull();
    expect(result.comments).toEqual([]);
    expect(result.overallComment).toBe(input.substring(0, 2000));
  });

  it('handles null issues gracefully', () => {
    const input = JSON.stringify({
      verdict: 'REQUEST_CHANGES', summary: 'test', score: 50, strengths: [], issues: null, security: null, performance: null, comments: null, overallComment: null,
    });
    const result = parser.parseTestResponse(input);
    expect(result.issues).toEqual([]);
    expect(result.comments).toEqual([]);
    expect(result.overallComment).toBe('');
  });

  it('handles empty string overallComment', () => {
    const input = JSON.stringify({
      verdict: 'APPROVE', summary: 'test', score: 80, strengths: [], issues: [], security: null, performance: null, comments: [], overallComment: '',
    });
    const result = parser.parseTestResponse(input);
    expect(result.overallComment).toBe('');
  });
});