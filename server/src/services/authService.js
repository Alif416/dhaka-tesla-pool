import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';

import { ERROR_CODES } from '../lib/errorCodes.js';
import { AppError } from '../lib/errors.js';
import { findUserByEmail, findUserById, insertPassenger } from '../repositories/userRepository.js';

const BCRYPT_COST = 12;
const BCRYPT_COST_TEST = 10;
const DUMMY_PASSWORD_FOR_TIMING = 'no-such-account-password';

const INVALID_CREDENTIALS = new AppError(
  ERROR_CODES.UNAUTHENTICATED,
  401,
  'Incorrect email or password.',
);

/**
 * Builds the auth service bound to one transaction runner and app config.
 * @param {{ withTx: (fn: (tx: unknown) => Promise<unknown>) => Promise<unknown>,
 *   config: { NODE_ENV: string, JWT_SECRET: string, JWT_EXPIRES_IN: string } }} deps
 * @returns {{ registerPassenger: Function, login: Function, getMe: Function }}
 */
export function createAuthService({ withTx, config }) {
  const bcryptCost = config.NODE_ENV === 'test' ? BCRYPT_COST_TEST : BCRYPT_COST;
  let dummyHash;

  async function getDummyHash() {
    dummyHash ??= await bcrypt.hash(DUMMY_PASSWORD_FOR_TIMING, bcryptCost);
    return dummyHash;
  }

  /**
   * Registers a new passenger. The role is always `PASSENGER`; it is never read from input.
   * @param {{ email: string, password: string, name: string }} input
   * @returns {Promise<object>} The created user row.
   */
  async function registerPassenger({ email, password, name }) {
    const passwordHash = await bcrypt.hash(password, bcryptCost);
    return withTx((tx) => insertPassenger(tx, { email, passwordHash, name }));
  }

  /**
   * Verifies credentials and issues a session token. An unknown email still runs a bcrypt
   * compare against a dummy hash, so a wrong email and a wrong password behave alike.
   * @param {{ email: string, password: string }} input
   * @returns {Promise<{ user: object, token: string }>}
   */
  async function login({ email, password }) {
    const user = await withTx((tx) => findUserByEmail(tx, email));
    const hashToCompare = user?.password_hash ?? (await getDummyHash());
    const passwordMatches = await bcrypt.compare(password, hashToCompare);

    if (!user || !passwordMatches) {
      throw INVALID_CREDENTIALS;
    }

    const token = jwt.sign({ sub: user.id, role: user.role }, config.JWT_SECRET, {
      expiresIn: config.JWT_EXPIRES_IN,
    });
    return { user, token };
  }

  /**
   * @param {{ id: string }} actor
   * @returns {Promise<object>} The current user row.
   */
  async function getMe(actor) {
    const user = await withTx((tx) => findUserById(tx, actor.id));
    if (!user) {
      throw new AppError(ERROR_CODES.UNAUTHENTICATED, 401, 'Sign in required.');
    }
    return user;
  }

  return { registerPassenger, login, getMe };
}
