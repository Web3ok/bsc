import pino from 'pino';
import knex, { Knex } from 'knex';
import { ConfigLoader } from '../config/loader';

const logger = pino({ name: 'Database' });

class Database {
  public connection: Knex | null = null;

  async initialize(): Promise<void> {
    try {
      const config = ConfigLoader.getInstance();
      const dbConfig = config.getDatabaseConfig();

      this.connection = knex({
        client: dbConfig.type === 'sqlite' ? 'sqlite3' : 'postgresql',
        connection: dbConfig.type === 'sqlite' ? {
          filename: dbConfig.path || './data/bot.db'
        } : dbConfig.url,
        useNullAsDefault: true,
        migrations: {
          directory: './src/persistence/migrations'
        }
      });

      await this.connection.raw('SELECT 1');
      logger.info('Database connection established');
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      logger.error({ error: errorMsg }, 'Failed to initialize database');
      throw error;
    }
  }

  async ensureConnection(): Promise<void> {
    if (!this.connection) {
      await this.initialize();
    }
  }

  async healthCheck(): Promise<boolean> {
    try {
      if (!this.connection) return false;
      await this.connection.raw('SELECT 1');
      return true;
    } catch {
      return false;
    }
  }

  getConnection(): Knex {
    if (!this.connection) {
      throw new Error('Database not initialized');
    }
    return this.connection;
  }

  async close(): Promise<void> {
    if (this.connection) {
      await this.connection.destroy();
      this.connection = null;
      logger.info('Database connection closed');
    }
  }

  async init(): Promise<void> {
    return this.initialize();
  }
}

export const database = new Database();