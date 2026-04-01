/**
 * Shared Kubernetes API client setup.
 *
 * Loads kubeconfig automatically:
 * - In-cluster: uses the mounted service account token
 * - Out-of-cluster: loads ~/.kube/config (or KUBECONFIG env var)
 *
 * Exports a singleton CoreV1Api instance used by ContainerSessionBackend.
 */

import * as k8s from '@kubernetes/client-node';

let _kc: k8s.KubeConfig | null = null;
let _coreApi: k8s.CoreV1Api | null = null;

function loadKubeConfig(): k8s.KubeConfig {
  if (_kc) return _kc;

  _kc = new k8s.KubeConfig();

  try {
    _kc.loadFromCluster();
    console.log('Loaded k8s config from in-cluster service account');
  } catch {
    _kc.loadFromDefault();
    console.log('Loaded k8s config from default kubeconfig');
  }

  return _kc;
}

export function getKubeConfig(): k8s.KubeConfig {
  return loadKubeConfig();
}

export function getCoreApi(): k8s.CoreV1Api {
  if (_coreApi) return _coreApi;
  const kc = loadKubeConfig();
  _coreApi = kc.makeApiClient(k8s.CoreV1Api);
  return _coreApi;
}

/**
 * Detect whether we are running inside a k8s cluster.
 * In-cluster pods have the KUBERNETES_SERVICE_HOST env var set.
 */
export function isInCluster(): boolean {
  return !!process.env.KUBERNETES_SERVICE_HOST;
}
