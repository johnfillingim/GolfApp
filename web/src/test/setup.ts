import 'fake-indexeddb/auto';
import '@testing-library/jest-dom/vitest';

// jsdom has no crypto.randomUUID in some versions, and the app leans on it for
// every ID it mints.
if (typeof globalThis.crypto === 'undefined') {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).crypto = {};
}
if (typeof globalThis.crypto.randomUUID !== 'function') {
  let counter = 0;
  Object.defineProperty(globalThis.crypto, 'randomUUID', {
    value: () => {
      counter += 1;
      return `00000000-0000-4000-8000-${String(counter).padStart(12, '0')}` as const;
    },
    configurable: true,
  });
}
