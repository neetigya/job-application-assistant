// Centralised logger — set DEBUG=true locally for verbose output.
// In production builds, debug() calls compile to no-ops so devtools stay clean.
const DEBUG = false;

const PREFIX = '[Job Assistant]';

export const logger = {
  debug: (...args: unknown[]) => { if (DEBUG) console.log(PREFIX, ...args); },
  info:  (...args: unknown[]) => console.log(PREFIX, ...args),
  warn:  (...args: unknown[]) => console.warn(PREFIX, ...args),
  error: (...args: unknown[]) => console.error(PREFIX, ...args),
};
