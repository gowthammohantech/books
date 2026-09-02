import { describe, expect, it } from 'vitest';

import { numberToWords } from './converters';

describe('numberToWords', () => {
  // The reason this function rounds. Five print templates hand it a persisted
  // Decimal(18,4), so before the guard every PDF with a fractional total showed
  // "undefined" where the pence should have been: num %= 100 left 45.67, and
  // ones[45.67 % 10] is ones[5.67], which does not exist.
  it('never emits "undefined" for a fractional amount', () => {
    for (const value of [145.67, 0.5, 99.99, 1234.01, 10_00_000.75]) {
      expect(numberToWords(value)).not.toContain('undefined');
    }
  });

  it('rounds a fractional amount to the nearest whole unit', () => {
    expect(numberToWords(145.67)).toBe('One Hundred Forty Six');
    expect(numberToWords(145.4)).toBe('One Hundred Forty Five');
    expect(numberToWords(100.6)).toBe('One Hundred One');
  });

  // Create screens floored and edit screens rounded, so a 100.60 invoice was
  // "One Hundred" on one and "One Hundred One" on the other. One rule now.
  it('describes the same amount identically however it is reached', () => {
    expect(numberToWords(100.6)).toBe(numberToWords(100.6));
    expect(numberToWords(101)).toBe(numberToWords(100.6));
  });

  it('handles the units, teens and tens boundaries', () => {
    expect(numberToWords(1)).toBe('One');
    expect(numberToWords(9)).toBe('Nine');
    expect(numberToWords(10)).toBe('Ten');
    expect(numberToWords(19)).toBe('Nineteen');
    expect(numberToWords(20)).toBe('Twenty');
    expect(numberToWords(21)).toBe('Twenty One');
    expect(numberToWords(99)).toBe('Ninety Nine');
  });

  it('scales through hundred, thousand, lakh and crore', () => {
    expect(numberToWords(100)).toBe('One Hundred');
    expect(numberToWords(1_000)).toBe('One Thousand');
    expect(numberToWords(1_00_000)).toBe('One Lakh');
    expect(numberToWords(1_00_00_000)).toBe('One Crore');
    expect(numberToWords(1_23_45_678)).toBe('One Crore Twenty Three Lakh Forty Five Thousand Six Hundred Seventy Eight');
  });

  it('returns zero for nothing, and for anything that rounds to nothing', () => {
    expect(numberToWords(0)).toBe('zero');
    expect(numberToWords(0.4)).toBe('zero');
  });

  // Callers guard with `if (grandTotal <= 0) return 'Zero'`, so a negative
  // should not reach here — but if one does, describe its magnitude rather than
  // indexing an array with a negative and emitting undefined.
  it('describes a negative amount by magnitude rather than breaking', () => {
    expect(numberToWords(-145)).toBe('One Hundred Forty Five');
    expect(numberToWords(-145)).not.toContain('undefined');
  });

  it('survives NaN rather than propagating it into the output', () => {
    expect(numberToWords(NaN)).toBe('zero');
  });
});
