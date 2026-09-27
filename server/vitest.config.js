import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    env: {
      NODE_ENV: 'test',
      TEST_DATABASE_URL:
        process.env.TEST_DATABASE_URL ??
        'postgres://ridepool:ridepool@localhost:5432/ridepool_test',
    },
    fileParallelism: false,
  },
});
