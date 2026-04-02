/**
 * Logger utility that respects the --quiet flag.
 *
 * Usage in commands:
 *   const log = createLogger(cmd.parent?.opts().quiet);
 *   log.info('Decorative message');   // suppressed in quiet mode
 *   log.success('✅ Done');           // suppressed in quiet mode
 *   log.warn('⚠ Warning');           // suppressed in quiet mode
 *   log.error('Error: ...');          // always shown (stderr)
 *   log.data(jsonOrTable);            // always shown (primary output)
 */

export interface Logger {
  /** Informational messages — suppressed in quiet mode */
  info(...args: unknown[]): void;
  /** Success messages — suppressed in quiet mode */
  success(...args: unknown[]): void;
  /** Warning messages — suppressed in quiet mode */
  warn(...args: unknown[]): void;
  /** Error messages — always shown on stderr */
  error(...args: unknown[]): void;
  /** Primary data output — always shown on stdout */
  data(...args: unknown[]): void;
  /** Whether quiet mode is active */
  readonly quiet: boolean;
}

const noop = (): void => {};

export function createLogger(quiet?: boolean): Logger {
  const isQuiet = quiet ?? false;
  return {
    info: isQuiet ? noop : (...args: unknown[]) => console.log(...args),
    success: isQuiet ? noop : (...args: unknown[]) => console.log(...args),
    warn: isQuiet ? noop : (...args: unknown[]) => console.log(...args),
    error: (...args: unknown[]) => console.error(...args),
    data: (...args: unknown[]) => console.log(...args),
    quiet: isQuiet,
  };
}
