import { describe, expect, it } from 'vitest';

import { parseConfig } from '../../src/lib/config.js';

const validEnv = {
  DATABASE_URL: 'postgres://ridepool:ridepool@db:5432/ridepool',
  JWT_SECRET: 'a-long-random-secret-with-at-least-32-characters',
};

describe('parseConfig', () => {
  it('applies defaults to a minimal valid environment', () => {
    const config = parseConfig(validEnv);

    expect(config.PORT).toBe(3000);
    expect(config.COOKIE_SECURE).toBe(false);
    expect(config.JWT_EXPIRES_IN).toBe('8h');
  });

  it('rejects a missing JWT_SECRET', () => {
    expect(() => parseConfig({ DATABASE_URL: validEnv.DATABASE_URL })).toThrow();
  });

  it('rejects a non-numeric PORT', () => {
    expect(() => parseConfig({ ...validEnv, PORT: 'abc' })).toThrow();
  });
});
