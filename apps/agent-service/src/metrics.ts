const metrics = {
  gatewayConnections: 0,
  activeGatewayConnections: 0,
  activePrompts: 0,
  promptCount: 0,
  internalAuthFailures: 0,
  websocketErrors: 0,
  ttftSamples: [] as number[],
};

const TTFT_MAX_SAMPLES = 1000;

export function gatewayConnectionOpened(): void {
  metrics.gatewayConnections += 1;
  metrics.activeGatewayConnections += 1;
}

export function gatewayConnectionClosed(): void {
  metrics.activeGatewayConnections = Math.max(0, metrics.activeGatewayConnections - 1);
}

export function promptStarted(): void {
  metrics.promptCount += 1;
  metrics.activePrompts += 1;
}

export function promptFinished(): void {
  metrics.activePrompts = Math.max(0, metrics.activePrompts - 1);
}

export function recordTtft(durationMs: number): void {
  metrics.ttftSamples.push(durationMs);
  if (metrics.ttftSamples.length > TTFT_MAX_SAMPLES) {
    metrics.ttftSamples.shift();
  }
}

export function internalAuthFailed(): void {
  metrics.internalAuthFailures += 1;
}

export function websocketErrored(): void {
  metrics.websocketErrors += 1;
}

export function getMetrics() {
  const samples = metrics.ttftSamples;
  const sorted = [...samples].sort((a, b) => a - b);
  const p50 = sorted.length > 0 ? sorted[Math.floor(sorted.length / 2)] : 0;
  const p95 = sorted.length > 0 ? sorted[Math.floor(sorted.length * 0.95)] : 0;
  const p99 = sorted.length > 0 ? sorted[Math.floor(sorted.length * 0.99)] : 0;

  return {
    gatewayConnections: metrics.gatewayConnections,
    activeGatewayConnections: metrics.activeGatewayConnections,
    activePrompts: metrics.activePrompts,
    promptCount: metrics.promptCount,
    internalAuthFailures: metrics.internalAuthFailures,
    websocketErrors: metrics.websocketErrors,
    ttftCount: samples.length,
    ttftP50Ms: p50,
    ttftP95Ms: p95,
    ttftP99Ms: p99,
  };
}
