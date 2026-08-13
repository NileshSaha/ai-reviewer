import { DataTypes, Model, Optional, Sequelize } from 'sequelize';

interface RepositoryAttributes {
  id: string;
  owner: string;
  name: string;
  fullName: string;
  isPollCheck: boolean;
  createdAt: Date;
  updatedAt: Date;
}

interface RepositoryCreationAttributes extends Optional<RepositoryAttributes, 'id' | 'isPollCheck' | 'createdAt' | 'updatedAt'> {}

class RepositoryModel extends Model<RepositoryAttributes, RepositoryCreationAttributes>
  implements RepositoryAttributes {
  declare id: string;
  declare owner: string;
  declare name: string;
  declare fullName: string;
  declare isPollCheck: boolean;
  declare createdAt: Date;
  declare updatedAt: Date;
}

export function initRepositoryModel(sequelize: Sequelize): typeof RepositoryModel {
  RepositoryModel.init(
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
      },
      owner: {
        type: DataTypes.STRING(255),
        allowNull: false,
      },
      name: {
        type: DataTypes.STRING(255),
        allowNull: false,
      },
      fullName: {
        type: DataTypes.STRING(510),
        allowNull: false,
      },
      isPollCheck: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: true,
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
      tableName: 'repositories',
      modelName: 'Repository',
      timestamps: true,
      indexes: [
        {
          unique: true,
          fields: ['owner', 'name'],
        },
      ],
    }
  );

  return RepositoryModel;
}

export { RepositoryModel, RepositoryAttributes, RepositoryCreationAttributes };
