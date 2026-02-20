import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.join(__dirname, 'data');
const testDbPath = path.join(dataDir, 'social_ai_test.db');

export async function setup(): Promise<void> {
  // Ensure data/ directory exists before any test worker initialises the DB
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
}

export async function teardown(): Promise<void> {
  // Remove the test DB and its WAL/SHM siblings after the full suite finishes
  for (const ext of ['', '-wal', '-shm']) {
    const file = testDbPath + ext;
    if (fs.existsSync(file)) fs.unlinkSync(file);
  }
}
