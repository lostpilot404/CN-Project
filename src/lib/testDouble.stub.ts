/**
 * Production stand-in for `src/lib/testDouble.ts`.
 *
 * The unit-test double is aliased to this module in every non-test build, so shipping code can
 * never return fabricated simulation data. Reaching this function means the app is running with
 * `import.meta.env.MODE === 'test'` but without the test alias configured, which is a bug.
 */
export function mockInvoke<T>(cmd: string): Promise<T> {
  return Promise.reject(
    new Error(`No simulation service is available for command '${cmd}' in this build.`),
  );
}
