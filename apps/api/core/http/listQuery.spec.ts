import { describe, it, expect } from 'vitest';

import { parseListQuery, toPositiveInt } from './listQuery';
import { toPagination, paginated } from './apiResponse';

describe('toPositiveInt', () => {
  it('takes a positive integer as given', () => {
    expect(toPositiveInt(5, 1)).toBe(5);
    expect(toPositiveInt('5', 1)).toBe(5);
  });

  it('floors a fractional value rather than rejecting it', () => {
    expect(toPositiveInt(2.9, 1)).toBe(2);
  });

  it('falls back for anything below 1, absent, or not a number', () => {
    for (const bad of [0, -3, 0.5, undefined, null, '', 'abc', NaN, Infinity, {}, []]) {
      expect(toPositiveInt(bad, 7)).toBe(7);
    }
  });
});

describe('parseListQuery', () => {
  it('defaults an empty query to page 1, limit 10, no search', () => {
    expect(parseListQuery({})).toEqual({ page: 1, limit: 10, search: '', skip: 0 });
    expect(parseListQuery(undefined)).toEqual({ page: 1, limit: 10, search: '', skip: 0 });
  });

  it('computes skip as (page - 1) * limit, the expression 31 controllers spell out', () => {
    expect(parseListQuery({ page: 3, limit: 25 }).skip).toBe(50);
    expect(parseListQuery({ page: 1, limit: 25 }).skip).toBe(0);
  });

  it('trims search and treats a non-string as absent', () => {
    expect(parseListQuery({ search: '  widget  ' }).search).toBe('widget');
    expect(parseListQuery({ search: ['a', 'b'] }).search).toBe('');
    expect(parseListQuery({ search: 42 }).search).toBe('');
  });

  // None of the existing copies caps this; `?limit=1000000` reaches Prisma's take.
  it('caps limit however large the caller asks', () => {
    expect(parseListQuery({ limit: 1_000_000 }).limit).toBe(200);
    expect(parseListQuery({ limit: 1_000_000 }, { maxLimit: 50 }).limit).toBe(50);
  });

  it('honours a caller-supplied default limit', () => {
    expect(parseListQuery({}, { defaultLimit: 25 }).limit).toBe(25);
  });

  it('falls back rather than producing a negative skip', () => {
    expect(parseListQuery({ page: -4 }).skip).toBe(0);
    expect(parseListQuery({ page: 0 }).page).toBe(1);
  });
});

describe('toPagination', () => {
  it('rounds the page count up', () => {
    expect(toPagination(21, 1, 10)).toEqual({ total: 21, page: 1, limit: 10, totalPages: 3 });
    expect(toPagination(20, 1, 10).totalPages).toBe(2);
  });

  it('reports zero pages for an empty result', () => {
    expect(toPagination(0, 1, 10).totalPages).toBe(0);
  });

  // Math.ceil(n / 0) is Infinity, which serialises to null in JSON.
  it('does not divide by a zero limit', () => {
    expect(toPagination(10, 1, 0).totalPages).toBe(0);
  });
});

describe('paginated', () => {
  it('nests the rows under the caller key alongside pagination', () => {
    const page = toPagination(1, 1, 10);
    expect(paginated('units', [{ id: 'u1' }], page)).toEqual({
      units: [{ id: 'u1' }],
      pagination: page,
    });
  });
});
