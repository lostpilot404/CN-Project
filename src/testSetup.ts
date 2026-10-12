/**
 * Vitest environment setup.
 *
 * jsdom is the test environment so component tests can mount real React trees; the simulation
 * double is aliased by `vite.config.ts` and is unreachable from any non-test build.
 */
import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

afterEach(() => {
  cleanup();
});
