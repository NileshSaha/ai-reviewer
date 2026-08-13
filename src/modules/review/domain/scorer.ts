import { ReviewDecision } from '../../ai/application/aiTypes';

export interface ScoringResult {
  decision: 'APPROVE' | 'REQUEST_CHANGES';
  score: number;
  threshold: number;
  aiVerdict: ReviewDecision;
  reason: string;
}

export class Scorer {
  constructor(private threshold: number = 80) {}

  decide(score: number, summary: string, aiVerdict: ReviewDecision): ScoringResult {
    const scoreMeetsThreshold = score >= this.threshold;
    const aiApproves = aiVerdict === 'APPROVE';
    const finalDecision = scoreMeetsThreshold && aiApproves ? 'APPROVE' : 'REQUEST_CHANGES';

    let reason: string;
    if (finalDecision === 'APPROVE') {
      reason = `Score ${score} meets threshold ${this.threshold} and AI verdict is APPROVE. ${summary}`;
    } else if (!scoreMeetsThreshold && !aiApproves) {
      reason = `Score ${score} below threshold ${this.threshold} and AI verdict is REQUEST_CHANGES. ${summary}`;
    } else if (!scoreMeetsThreshold) {
      reason = `Score ${score} below threshold ${this.threshold}. AI requested changes. ${summary}`;
    } else {
      reason = `AI verdict REQUEST_CHANGES overrode score ${score} (meets threshold ${this.threshold}). ${summary}`;
    }

    return { decision: finalDecision, score, threshold: this.threshold, aiVerdict, reason };
  }
}