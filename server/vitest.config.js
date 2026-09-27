import { defineConfig } from 'vitest/config';

process.env.TEST_DATABASE_URL ??= 'postgres://ridepool:ridepool@localhost:5432/ridepool_test';

export default defineConfig({
  test: {
    env: { NODE_ENV: 'test' },
    globalSetup: ['./tests/helpers/globalSetup.js'],
    fileParallelism: false,
  },
});
