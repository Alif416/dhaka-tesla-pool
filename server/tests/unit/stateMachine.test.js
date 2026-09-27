import { describe, expect, it } from 'vitest';

import { POOL_STATUSES, RIDE_STATUSES } from '../../src/domain/constants.js';
import {
  canCancelPool,
  canCompleteRide,
  canEndTrip,
  canGoOffline,
  canNoShowMember,
  canPassengerCancelRide,
  canTransitionPool,
  canTransitionRide,
} from '../../src/domain/stateMachine.js';

const RIDE_STATUS_LIST = Object.values(RIDE_STATUSES);
const POOL_STATUS_LIST = Object.values(POOL_STATUSES);

const ALLOWED_RIDE_TRANSITIONS = new Set([
  'REQUESTED->MATCHED',
  'REQUESTED->CANCELLED',
  'MATCHED->DRIVER_ARRIVED',
  'MATCHED->CANCELLED',
  'MATCHED->REQUESTED',
  'DRIVER_ARRIVED->STARTED',
  'DRIVER_ARRIVED->CANCELLED',
  'DRIVER_ARRIVED->REQUESTED',
  'STARTED->COMPLETED',
]);

const ALLOWED_POOL_TRANSITIONS = new Set([
  'ACCEPTED->DRIVER_ARRIVED',
  'ACCEPTED->CANCELLED',
  'DRIVER_ARRIVED->STARTED',
  'DRIVER_ARRIVED->CANCELLED',
  'STARTED->COMPLETED',
]);

describe('canTransitionRide', () => {
  it.each(RIDE_STATUS_LIST.flatMap((from) => RIDE_STATUS_LIST.map((to) => [from, to])))(
    'from %s to %s matches the documented ride state machine',
    (from, to) => {
      expect(canTransitionRide(from, to)).toBe(ALLOWED_RIDE_TRANSITIONS.has(`${from}->${to}`));
    },
  );

  it('has no general CANCELLED -> REQUESTED transition', () => {
    expect(canTransitionRide(RIDE_STATUSES.CANCELLED, RIDE_STATUSES.REQUESTED)).toBe(false);
  });
});

describe('canTransitionPool', () => {
  it.each(POOL_STATUS_LIST.flatMap((from) => POOL_STATUS_LIST.map((to) => [from, to])))(
    'from %s to %s matches the documented pool state machine',
    (from, to) => {
      expect(canTransitionPool(from, to)).toBe(ALLOWED_POOL_TRANSITIONS.has(`${from}->${to}`));
    },
  );
});

describe('section 4.3: who can do what', () => {
  it('a passenger can cancel their own ride only in REQUESTED, MATCHED or DRIVER_ARRIVED', () => {
    expect(canPassengerCancelRide(RIDE_STATUSES.REQUESTED)).toBe(true);
    expect(canPassengerCancelRide(RIDE_STATUSES.MATCHED)).toBe(true);
    expect(canPassengerCancelRide(RIDE_STATUSES.DRIVER_ARRIVED)).toBe(true);
    expect(canPassengerCancelRide(RIDE_STATUSES.STARTED)).toBe(false);
    expect(canPassengerCancelRide(RIDE_STATUSES.COMPLETED)).toBe(false);
    expect(canPassengerCancelRide(RIDE_STATUSES.CANCELLED)).toBe(false);
  });

  it('no-show is only legal while the pool is DRIVER_ARRIVED', () => {
    expect(canNoShowMember(POOL_STATUSES.DRIVER_ARRIVED)).toBe(true);
    expect(canNoShowMember(POOL_STATUSES.ACCEPTED)).toBe(false);
    expect(canNoShowMember(POOL_STATUSES.STARTED)).toBe(false);
  });

  it('a ride can be completed only while STARTED', () => {
    expect(canCompleteRide(RIDE_STATUSES.STARTED)).toBe(true);
    expect(canCompleteRide(RIDE_STATUSES.DRIVER_ARRIVED)).toBe(false);
    expect(canCompleteRide(RIDE_STATUSES.COMPLETED)).toBe(false);
  });

  it('End Trip is only legal while the pool is STARTED', () => {
    expect(canEndTrip(POOL_STATUSES.STARTED)).toBe(true);
    expect(canEndTrip(POOL_STATUSES.DRIVER_ARRIVED)).toBe(false);
  });

  it('cancel pool is legal only in ACCEPTED or DRIVER_ARRIVED', () => {
    expect(canCancelPool(POOL_STATUSES.ACCEPTED)).toBe(true);
    expect(canCancelPool(POOL_STATUSES.DRIVER_ARRIVED)).toBe(true);
    expect(canCancelPool(POOL_STATUSES.STARTED)).toBe(false);
  });

  it('go offline is legal only with no active pool', () => {
    expect(canGoOffline(false)).toBe(true);
    expect(canGoOffline(true)).toBe(false);
  });
});
