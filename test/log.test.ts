import { describe, expect, it, vi } from 'vitest';
import { createLogger } from '../src/utils/log.js';

describe('createLogger', () => {
  it('returns a logger with quiet=false by default', () => {
    const log = createLogger();
    expect(log.quiet).toBe(false);
  });

  it('returns a logger with quiet=true when passed true', () => {
    const log = createLogger(true);
    expect(log.quiet).toBe(true);
  });

  it('info/success/warn output to console.log when not quiet', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const log = createLogger(false);

    log.info('info message');
    log.success('success message');
    log.warn('warn message');

    expect(spy).toHaveBeenCalledTimes(3);
    expect(spy).toHaveBeenCalledWith('info message');
    expect(spy).toHaveBeenCalledWith('success message');
    expect(spy).toHaveBeenCalledWith('warn message');
    spy.mockRestore();
  });

  it('info/success/warn are suppressed when quiet', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const log = createLogger(true);

    log.info('info message');
    log.success('success message');
    log.warn('warn message');

    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it('error always outputs to console.error', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const quietLog = createLogger(true);
    const normalLog = createLogger(false);

    quietLog.error('error in quiet');
    normalLog.error('error in normal');

    expect(spy).toHaveBeenCalledTimes(2);
    expect(spy).toHaveBeenCalledWith('error in quiet');
    expect(spy).toHaveBeenCalledWith('error in normal');
    spy.mockRestore();
  });

  it('data always outputs to console.log even when quiet', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const log = createLogger(true);

    log.data('primary output');

    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith('primary output');
    spy.mockRestore();
  });

  it('handles undefined quiet parameter as false', () => {
    const log = createLogger(undefined);
    expect(log.quiet).toBe(false);

    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    log.info('should output');
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });
});
