const metrics = {
  gatewayConnections: 0,
  activeGatewayConnections: 0,
  activePrompts: 0,
  promptCount: 0,
  internalAuthFailures: 0,
  websocketErrors: 0,
};

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

export function internalAuthFailed(): void {
  metrics.internalAuthFailures += 1;
}

export function websocketErrored(): void {
  metrics.websocketErrors += 1;
}

export function getMetrics() {
  return { ...metrics };
}
