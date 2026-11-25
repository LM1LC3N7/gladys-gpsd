// Waits (real time) for a condition, failing fast: never a test that hangs.
export async function until(condition, { timeoutMs = 3000, what = 'condition' } = {}) {
  const deadline = performance.now() + timeoutMs;
  while (!(await condition())) {
    if (performance.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 2));
  }
}
