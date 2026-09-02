import { describe, it, expect } from 'vitest';
import { stripPort } from './rateLimitKey';

describe('stripPort', () => {
  it('drops an Azure-appended IPv4 port', () => {
    expect(stripPort('106.51.59.68:51977')).toBe('106.51.59.68');
  });
  it('leaves a bare IPv4 alone', () => {
    expect(stripPort('106.51.59.68')).toBe('106.51.59.68');
  });
  it('unwraps a bracketed IPv6 with and without a port', () => {
    expect(stripPort('[::1]:443')).toBe('::1');
    expect(stripPort('[2001:db8::1]')).toBe('2001:db8::1');
  });
  it('leaves a bare IPv6 alone', () => {
    expect(stripPort('::1')).toBe('::1');
    expect(stripPort('2001:db8::1')).toBe('2001:db8::1');
    expect(stripPort('::ffff:1.2.3.4')).toBe('::ffff:1.2.3.4');
  });
});
