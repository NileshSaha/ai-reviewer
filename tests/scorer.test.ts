import { Scorer } from '../src/modules/review/domain/scorer';

describe('Scorer', () => {
  let scorer: Scorer;

  beforeEach(() => {
    scorer = new Scorer(80);
  });

  describe('decide', () => {
    it('should return APPROVE when both score meets threshold and AI approves', () => {
      const result = scorer.decide(80, 'Good code', 'APPROVE');
      expect(result.decision).toBe('APPROVE');
      expect(result.score).toBe(80);
      expect(result.threshold).toBe(80);
      expect(result.aiVerdict).toBe('APPROVE');
    });

    it('should return APPROVE when score is above threshold and AI approves', () => {
      const result = scorer.decide(95, 'Excellent code', 'APPROVE');
      expect(result.decision).toBe('APPROVE');
      expect(result.score).toBe(95);
      expect(result.aiVerdict).toBe('APPROVE');
    });

    it('should return REQUEST_CHANGES when score is below threshold and AI requests changes', () => {
      const result = scorer.decide(60, 'Needs improvement', 'REQUEST_CHANGES');
      expect(result.decision).toBe('REQUEST_CHANGES');
      expect(result.score).toBe(60);
      expect(result.aiVerdict).toBe('REQUEST_CHANGES');
    });

    it('should return REQUEST_CHANGES when score is 79 and AI requests changes', () => {
      const result = scorer.decide(79, 'Almost there', 'REQUEST_CHANGES');
      expect(result.decision).toBe('REQUEST_CHANGES');
    });

    it('should return REQUEST_CHANGES when score meets threshold but AI requests changes (cross-check override)', () => {
      const result = scorer.decide(85, 'Seems fine but AI disagrees', 'REQUEST_CHANGES');
      expect(result.decision).toBe('REQUEST_CHANGES');
      expect(result.reason).toContain('overrode');
    });

    it('should return REQUEST_CHANGES when AI approves but score is below threshold (score veto)', () => {
      const result = scorer.decide(70, 'AI approves but score low', 'APPROVE');
      expect(result.decision).toBe('REQUEST_CHANGES');
      expect(result.reason).toContain('below threshold');
    });

    it('should include summary in reason', () => {
      const result = scorer.decide(90, 'Great work', 'APPROVE');
      expect(result.reason).toContain('Great work');
    });

    it('should work with custom threshold', () => {
      const customScorer = new Scorer(70);
      const result = customScorer.decide(75, 'Meets custom threshold', 'APPROVE');
      expect(result.decision).toBe('APPROVE');
    });

    it('should handle edge case of score 0', () => {
      const result = scorer.decide(0, 'Terrible code', 'REQUEST_CHANGES');
      expect(result.decision).toBe('REQUEST_CHANGES');
      expect(result.score).toBe(0);
    });

    it('should handle edge case of score 100', () => {
      const result = scorer.decide(100, 'Perfect code', 'APPROVE');
      expect(result.decision).toBe('APPROVE');
      expect(result.score).toBe(100);
    });

    it('should handle AI approving at score 79 (just below threshold)', () => {
      const result = scorer.decide(79, 'Good but score low', 'APPROVE');
      expect(result.decision).toBe('REQUEST_CHANGES');
      expect(result.reason).toContain('below threshold');
    });

    it('should handle AI requesting changes at score 100', () => {
      const result = scorer.decide(100, 'Perfect but AI says no', 'REQUEST_CHANGES');
      expect(result.decision).toBe('REQUEST_CHANGES');
      expect(result.reason).toContain('overrode');
    });
  });
});