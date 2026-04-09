const relayMetrics = {
  browserConnections: 0,
  activeBrowserConnections: 0,
  agentConnections: 0,
  activeAgentConnections: 0,
  authAttempts: 0,
  authFailures: 0,
  relayErrors: 0,
};

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

export function getRelayMetrics() {
  return { ...relayMetrics };
}
