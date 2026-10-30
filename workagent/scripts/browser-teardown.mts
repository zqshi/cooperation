// Dispose the isolated fixture before Playwright terminates its process group.
// Never connect this harness to a live/customer database.
export default async function teardown() {
  const response = await fetch("http://127.0.0.1:16100/mock/browser-cleanup", {
    method: "POST",
    signal: AbortSignal.timeout(5000),
  });
  if (!response.ok)
    throw new Error(`Isolated browser cleanup failed: ${response.status}`);
}
