import { describe, expect, it, vi } from 'vitest';
import { PodManager } from '../src/pod-manager';

describe('PodManager', () => {
  it('does not inject provider API keys into sandbox pod env', () => {
    const manager = new PodManager();
    const spec = (manager as unknown as { buildPodSpec: (name: string, userId: string) => { spec: { containers: Array<{ env?: Array<{ name: string; value: string }> }> } } })
      .buildPodSpec('agent-user123', 'user123');

    const env = spec.spec.containers[0].env ?? [];
    const names = env.map((entry) => entry.name);

    expect(names).toEqual(['USER_ID', 'HOME']);
    expect(names).not.toContain('ANTHROPIC_API_KEY');
    expect(names).not.toContain('OPENAI_API_KEY');
    expect(names).not.toContain('GEMINI_API_KEY');

    void manager.shutdown();
  });

  it('preserves sandbox pods on shutdown by default', async () => {
    const manager = new PodManager();
    const deleteSpy = vi.spyOn(manager, 'deletePod').mockResolvedValue();
    (manager as unknown as { pods: Map<string, unknown> }).pods.set('user-a', {
      podName: 'agent-usera',
      userId: 'user-a',
      status: 'running',
      lastActive: Date.now(),
      consecutiveFailures: 0,
    });

    await manager.shutdown();

    expect(deleteSpy).not.toHaveBeenCalled();
  });
});
