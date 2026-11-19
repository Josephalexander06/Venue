import { afterAll } from 'vitest';
import './env.js';
import { closeTestDatabase } from './helpers.js';

afterAll(async () => {
  await closeTestDatabase();
});
