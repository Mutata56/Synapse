/** Dev-only counters; no polling, storage, network or React updates in the app. */
const counters: Record<string, number> = Object.create(null);
export function recordGraphDiagnostic(name: string, amount = 1) {
  if (!import.meta.env?.DEV) return;
  counters[name] = (counters[name] ?? 0) + amount;
}
export function getGraphDiagnostics(): Record<string, number> { return { ...counters }; }
