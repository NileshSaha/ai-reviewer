import { DataTypes, Model, Optional, Sequelize } from 'sequelize';

export interface ProviderPriorityAttributes {
  id: string;
  provider: string;
  priority: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface ProviderPriorityCreationAttributes
  extends Optional<ProviderPriorityAttributes, 'id' | 'createdAt' | 'updatedAt'> {}

export class ProviderPriorityModel
  extends Model<ProviderPriorityAttributes, ProviderPriorityCreationAttributes>
  implements ProviderPriorityAttributes {
  declare id: string;
  declare provider: string;
  declare priority: number;
  declare createdAt: Date;
  declare updatedAt: Date;
}

export function initProviderPriorityModel(sequelize: Sequelize): typeof ProviderPriorityModel {
  ProviderPriorityModel.init(
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
      },
      provider: {
        type: DataTypes.STRING(100),
        allowNull: false,
        unique: true,
      },
      priority: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
      createdAt: {
        type: DataTypes.DATE,
        allowNull: false,
      },
      updatedAt: {
        type: DataTypes.DATE,
        allowNull: false,
      },
    },
    {
      sequelize,
      tableName: 'provider_priorities',
      modelName: 'ProviderPriority',
      timestamps: true,
      indexes: [
        {
          unique: true,
          fields: ['provider'],
        },
        {
          fields: ['priority'],
        },
      ],
    }
  );

  return ProviderPriorityModel;
}
