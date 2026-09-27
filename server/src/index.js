import { createApp } from './app.js';
import { createPool } from './db/client.js';
import { loadConfig } from './lib/config.js';

const config = loadConfig();
const pool = createPool(config.DATABASE_URL);
const app = createApp({ pool, config });

app.listen(config.PORT, () => {
  process.stdout.write(`${JSON.stringify({ event: 'listening', port: config.PORT })}\n`);
});
