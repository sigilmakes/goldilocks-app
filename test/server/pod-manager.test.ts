import { describe, expect, it } from 'vitest';
import { PodManager } from '../../server/src/agent/pod-manager';

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
});
