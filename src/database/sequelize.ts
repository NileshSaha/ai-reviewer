import { Sequelize } from 'sequelize';
import { Logger } from '../shared/types/logger';

let sequelizeInstance: Sequelize | null = null;

export function createSequelize(databaseUrl: string, logger: Logger): Sequelize {
  if (sequelizeInstance) {
    return sequelizeInstance;
  }

  sequelizeInstance = new Sequelize(databaseUrl, {
    logging: (msg) => logger.debug(msg, { module: 'sequelize' }),
    dialect: 'postgres',
    pool: {
      max: 5,
      min: 0,
      acquire: 30000,
      idle: 10000,
    },
  });

  return sequelizeInstance;
}

export function getSequelize(): Sequelize {
  if (!sequelizeInstance) {
    throw new Error('Sequelize instance not initialized. Call createSequelize first.');
  }
  return sequelizeInstance;
}

export { createSequelize as createSequelizeInstance };

export const sequelize = {
  get instance() {
    return getSequelize();
  },
};
