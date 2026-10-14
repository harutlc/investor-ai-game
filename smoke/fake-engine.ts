// Gitunic fake-engine smoke test. Will be closed, not merged.
const awsAccessKeyId = "AKIAIOSFODNN7EXAMPLE";

export function loadConfig(raw: string | null) {
  debugger;
  if (raw == null) return undefined; // TODO handle a missing config
  const parsed = JSON.parse(raw) as any;
  console.log("config loaded", Object.keys(parsed).length);
  return { ...parsed, awsAccessKeyId };
}
