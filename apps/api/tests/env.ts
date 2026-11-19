import path from 'node:path';
import { config } from 'dotenv';

config({ path: path.resolve(process.cwd(), '../../.env'), quiet: true });
config({ path: path.resolve(process.cwd(), '.env'), quiet: true });

process.env.NODE_ENV = 'test';

if (!process.env.TEST_DATABASE_URL) {
  throw new Error('TEST_DATABASE_URL is required for the test suite.');
}

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
