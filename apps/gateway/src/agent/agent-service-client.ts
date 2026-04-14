import { CONFIG } from '@goldilocks/config';

export async function agentServiceFetch(
  path: string,
  options: RequestInit & { userToken: string },
): Promise<Response> {
  const headers = new Headers(options.headers ?? {});
  headers.set('authorization', `Bearer ${options.userToken}`);
  headers.set('x-goldilocks-shared-secret', CONFIG.agentServiceSharedSecret);

  return fetch(`${CONFIG.agentServiceUrl}${path}`, {
    ...options,
    headers,
  });
}
