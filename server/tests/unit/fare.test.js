import { describe, expect, it } from 'vitest';

import { computeFare, computeSoloFare, discountPercent, nextQuote } from '../../src/domain/fare.js';

describe('computeSoloFare', () => {
  it('reproduces the demo solo fares', () => {
    expect(computeSoloFare({ seats: 1, distanceUnits: 3 })).toBe(10000); // Nusrat, ৳100
    expect(computeSoloFare({ seats: 1, distanceUnits: 2 })).toBe(8000); // Rafiq/Shirin, ৳80
  });

  it('pays double for a 2-seat booking', () => {
    expect(computeSoloFare({ seats: 2, distanceUnits: 3 })).toBe(20000);
  });

  it('throws on a non-integer input', () => {
    expect(() => computeSoloFare({ seats: 1.5, distanceUnits: 3 })).toThrow(TypeError);
  });
});

describe('discountPercent', () => {
  it('is 0, 10, 15 for 1, 2, 3 passengers', () => {
    expect(discountPercent(1)).toBe(0);
    expect(discountPercent(2)).toBe(10);
    expect(discountPercent(3)).toBe(15);
  });

  it('throws for an unsupported passenger count', () => {
    expect(() => discountPercent(4)).toThrow(RangeError);
    expect(() => discountPercent(0)).toThrow(RangeError);
  });
});

describe('computeFare', () => {
  it('reproduces the full demo verification table', () => {
    expect(computeFare({ soloFarePaisa: 10000, passengerCount: 1 })).toBe(10000);
    expect(computeFare({ soloFarePaisa: 10000, passengerCount: 2 })).toBe(9000);
    expect(computeFare({ soloFarePaisa: 10000, passengerCount: 3 })).toBe(8500);
    expect(computeFare({ soloFarePaisa: 8000, passengerCount: 1 })).toBe(8000);
    expect(computeFare({ soloFarePaisa: 8000, passengerCount: 2 })).toBe(7200);
    expect(computeFare({ soloFarePaisa: 8000, passengerCount: 3 })).toBe(6800);
  });

  it('rounds 101 paisa at 15% up to 86', () => {
    expect(computeFare({ soloFarePaisa: 101, passengerCount: 3 })).toBe(86);
  });

  it('throws on a non-integer solo fare', () => {
    expect(() => computeFare({ soloFarePaisa: 100.5, passengerCount: 1 })).toThrow(TypeError);
  });
});

describe('nextQuote', () => {
  it('never returns a value larger than the current quote', () => {
    expect(nextQuote({ quotedFarePaisa: 10000, computedFarePaisa: 9000 })).toBe(9000);
    expect(nextQuote({ quotedFarePaisa: 8500, computedFarePaisa: 9000 })).toBe(8500);
  });

  it('throws on a non-integer input', () => {
    expect(() => nextQuote({ quotedFarePaisa: 100.1, computedFarePaisa: 100 })).toThrow(TypeError);
  });
});
