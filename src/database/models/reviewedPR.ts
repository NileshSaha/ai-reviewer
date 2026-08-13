import { DataTypes, Model, Optional, Sequelize } from 'sequelize';

interface ReviewedPRAttributes {
  id: string;
  repository: string;
  prNumber: number;
  headSha: string;
  reviewedAt: Date;
}

interface ReviewedPRCreationAttributes extends Optional<ReviewedPRAttributes, 'id'> {}

class ReviewedPRModel extends Model<ReviewedPRAttributes, ReviewedPRCreationAttributes>
  implements ReviewedPRAttributes {
  declare id: string;
  declare repository: string;
  declare prNumber: number;
  declare headSha: string;
  declare reviewedAt: Date;
}

export function initReviewedPRModel(sequelize: Sequelize): typeof ReviewedPRModel {
  ReviewedPRModel.init(
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
      },
      repository: {
        type: DataTypes.STRING(500),
        allowNull: false,
      },
      prNumber: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
      headSha: {
        type: DataTypes.STRING(100),
        allowNull: false,
      },
      reviewedAt: {
        type: DataTypes.DATE,
        allowNull: false,
      },
    },
    {
      sequelize,
      tableName: 'reviewed_prs',
      modelName: 'ReviewedPR',
      timestamps: false,
      indexes: [
        {
          unique: true,
          fields: ['repository', 'prNumber', 'headSha'],
        },
        {
          fields: ['repository', 'prNumber'],
        },
      ],
    }
  );

  return ReviewedPRModel;
}

export { ReviewedPRModel, ReviewedPRAttributes, ReviewedPRCreationAttributes };
