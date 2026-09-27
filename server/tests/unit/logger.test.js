import { Writable } from 'node:stream';

import { describe, expect, it } from 'vitest';

import { createLogger } from '../../src/lib/logger.js';

function collectingStream() {
  const chunks = [];
  const stream = new Writable({
    write(chunk, encoding, callback) {
      chunks.push(chunk.toString());
      callback();
    },
  });
  return { stream, lines: () => chunks.join('') };
}

describe('createLogger redaction', () => {
  it('redacts the request cookie header, the set-cookie response header, and body passwords', () => {
    const { stream, lines } = collectingStream();
    const logger = createLogger({ level: 'info', destination: stream });

    logger.info(
      {
        req: {
          headers: { cookie: 'rp_session=super-secret-token' },
          body: { password: 'correct-horse', email: 'a@example.com' },
        },
        res: { headers: { 'set-cookie': 'rp_session=super-secret-token; HttpOnly' } },
      },
      'test event',
    );

    const output = lines();
    expect(output).not.toMatch(/super-secret-token/);
    expect(output).not.toMatch(/correct-horse/);
    expect(output).toMatch(/a@example\.com/); // only credentials are redacted, not everything
    expect(output).toMatch(/\[redacted\]/);
  });
});
