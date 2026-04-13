import { CONFIG } from '@goldilocks/config';

export async function agentServiceFetch(
  path: string,
  options: RequestInit & { userId: string },
): Promise<Response> {
  const headers = new Headers(options.headers ?? {});
  headers.set('x-goldilocks-user', options.userId);
  headers.set('x-goldilocks-shared-secret', CONFIG.agentServiceSharedSecret);

  return fetch(`${CONFIG.agentServiceUrl}${path}`, {
    ...options,
    headers,
  });
}
