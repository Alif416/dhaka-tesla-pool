import { describe, expect, it } from 'vitest';

import {
  NO_DISTANCE,
  PICKUP_EQUALS_DESTINATION,
  direction,
  distanceUnits,
  isPoolable,
  makeCrossDistanceKey,
} from '../../src/domain/geography.js';

const BANANI = { id: 1, corridor: 'NORTH', position: 10 };
const GULSHAN_1 = { id: 2, corridor: 'NORTH', position: 12 };
const MOHAKHALI = { id: 3, corridor: 'NORTH', position: 13 };
const DHANMONDI = { id: 6, corridor: 'WEST', position: 10 };
const FARMGATE = { id: 7, corridor: 'WEST', position: 13 };

const crossDistances = new Map([[makeCrossDistanceKey(BANANI.id, DHANMONDI.id), 8]]);

describe('distanceUnits', () => {
  it('is the absolute position difference on the same corridor', () => {
    expect(distanceUnits(BANANI, MOHAKHALI, crossDistances)).toEqual({
      ok: true,
      distanceUnits: 3,
    });
  });

  it('looks up a cross-corridor pair regardless of argument order', () => {
    expect(distanceUnits(BANANI, DHANMONDI, crossDistances)).toEqual({
      ok: true,
      distanceUnits: 8,
    });
    expect(distanceUnits(DHANMONDI, BANANI, crossDistances)).toEqual({
      ok: true,
      distanceUnits: 8,
    });
  });

  it('fails with NO_DISTANCE when the cross-corridor pair is missing', () => {
    expect(distanceUnits(BANANI, FARMGATE, crossDistances)).toEqual({
      ok: false,
      code: NO_DISTANCE,
    });
  });

  it('fails with PICKUP_EQUALS_DESTINATION when pickup and destination are the same zone', () => {
    expect(distanceUnits(BANANI, BANANI, crossDistances)).toEqual({
      ok: false,
      code: PICKUP_EQUALS_DESTINATION,
    });
  });
});

describe('isPoolable', () => {
  it('is true only when pickup and destination share a corridor', () => {
    expect(isPoolable(BANANI, MOHAKHALI)).toBe(true);
    expect(isPoolable(BANANI, DHANMONDI)).toBe(false);
  });
});

describe('direction', () => {
  it('is +1 towards a higher position and -1 towards a lower one', () => {
    expect(direction(BANANI, MOHAKHALI)).toBe(1);
    expect(direction(MOHAKHALI, BANANI)).toBe(-1);
  });

  it('agrees for Rafiq (Banani to Gulshan 1) and Nusrat (Banani to Mohakhali)', () => {
    expect(direction(BANANI, GULSHAN_1)).toBe(direction(BANANI, MOHAKHALI));
  });
});
