const relayMetrics = {
  browserConnections: 0,
  activeBrowserConnections: 0,
  agentConnections: 0,
  activeAgentConnections: 0,
  authAttempts: 0,
  authFailures: 0,
  relayErrors: 0,
  ttftSamples: [] as number[],
};

const TTFT_MAX_SAMPLES = 1000;

export function recordBrowserConnectionOpened(): void {
  relayMetrics.browserConnections += 1;
  relayMetrics.activeBrowserConnections += 1;
}

export function recordBrowserConnectionClosed(): void {
  relayMetrics.activeBrowserConnections = Math.max(0, relayMetrics.activeBrowserConnections - 1);
}

export function recordAgentConnectionOpened(): void {
  relayMetrics.agentConnections += 1;
  relayMetrics.activeAgentConnections += 1;
}

export function recordAgentConnectionClosed(): void {
  relayMetrics.activeAgentConnections = Math.max(0, relayMetrics.activeAgentConnections - 1);
}

export function recordAuthAttempt(success: boolean): void {
  relayMetrics.authAttempts += 1;
  if (!success) {
    relayMetrics.authFailures += 1;
  }
}

export function recordRelayError(): void {
  relayMetrics.relayErrors += 1;
}

export function recordTtft(durationMs: number): void {
  relayMetrics.ttftSamples.push(durationMs);
  if (relayMetrics.ttftSamples.length > TTFT_MAX_SAMPLES) {
    relayMetrics.ttftSamples.shift();
  }
}

export function getRelayMetrics() {
  const samples = relayMetrics.ttftSamples;
  const sorted = [...samples].sort((a, b) => a - b);
  const p50 = sorted.length > 0 ? sorted[Math.floor(sorted.length / 2)] : 0;
  const p95 = sorted.length > 0 ? sorted[Math.floor(sorted.length * 0.95)] : 0;
  const p99 = sorted.length > 0 ? sorted[Math.floor(sorted.length * 0.99)] : 0;

  return {
    ...relayMetrics,
    ttftSamples: undefined,
    ttftCount: samples.length,
    ttftP50Ms: p50,
    ttftP95Ms: p95,
    ttftP99Ms: p99,
  };
}