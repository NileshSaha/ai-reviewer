import { v4 as uuidv4 } from 'uuid';
import { ReviewRepository } from '../application/reviewRepository';
import { ReviewedPR, ReviewedPRCreate } from '../domain/reviewedPR';
import { ReviewedPRModel } from '../../../database/models/reviewedPR';
import { Logger } from '../../../shared/types/logger';

export class SequelizeReviewRepository implements ReviewRepository {
  constructor(private logger: Logger) {}

  async create(review: ReviewedPRCreate): Promise<ReviewedPR> {
    this.logger.debug('Creating reviewed PR record', {
      repository: review.repository,
      pr_number: review.prNumber,
    });

    const model = await ReviewedPRModel.create({
      id: uuidv4(),
      repository: review.repository,
      prNumber: review.prNumber,
      headSha: review.headSha,
      reviewedAt: review.reviewedAt,
    });

    return this.mapToEntity(model);
  }

  async findByRepoAndPR(repository: string, prNumber: number): Promise<ReviewedPR | null> {
    const model = await ReviewedPRModel.findOne({
      where: { repository, prNumber },
      order: [['reviewedAt', 'DESC']],
    });

    return model ? this.mapToEntity(model) : null;
  }

  async hasBeenReviewedWithSameSHA(
    repository: string,
    prNumber: number,
    headSha: string
  ): Promise<boolean> {
    const existing = await ReviewedPRModel.findOne({
      where: { repository, prNumber, headSha },
    });

    return existing !== null;
  }

  async update(review: ReviewedPR): Promise<ReviewedPR> {
    const model = await ReviewedPRModel.findByPk(review.id);
    if (!model) {
      throw new Error(`ReviewedPR not found: ${review.id}`);
    }

    await model.update({
      repository: review.repository,
      prNumber: review.prNumber,
      headSha: review.headSha,
      reviewedAt: review.reviewedAt,
    });

    return this.mapToEntity(model);
  }

  async delete(id: string): Promise<void> {
    await ReviewedPRModel.destroy({ where: { id } });
  }

  async findAll(): Promise<ReviewedPR[]> {
    const models = await ReviewedPRModel.findAll({
      order: [['reviewedAt', 'DESC']],
    });

    return models.map(this.mapToEntity);
  }

  private mapToEntity(model: ReviewedPRModel): ReviewedPR {
    return {
      id: model.id,
      repository: model.repository,
      prNumber: model.prNumber,
      headSha: model.headSha,
      reviewedAt: model.reviewedAt,
    };
  }
}
