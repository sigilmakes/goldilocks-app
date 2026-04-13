# -*- mode: Python -*-

update_settings(suppress_unused_image_warnings=['goldilocks-agent'])

update_settings(max_parallel_updates=3)

# ── Dev Secrets ──
# Generate deterministic dev secrets so `tilt up` works with zero manual steps.
# Production uses real secrets created out-of-band.
k8s_yaml(blob("""
apiVersion: v1
kind: Secret
metadata:
  name: app-secrets
  namespace: goldilocks
type: Opaque
stringData:
  jwt-secret: dev-jwt-secret-not-for-production
  encryption-key: dev-encryption-key-not-for-prod
  agent-service-shared-secret: dev-agent-service-secret
"""))

# ── k8s Infrastructure ──
k8s_yaml([
    'infra/k8s/namespace.yaml',
    'infra/k8s/rbac.yaml',
    'ops/headlamp/k8s/headlamp-rbac.yaml',
    'ops/headlamp/k8s/headlamp.yaml',
])

# ── Web App ──
docker_build(
    'goldilocks-web',
    '.',
    dockerfile='infra/docker/Dockerfile.web.dev',
    only=[
        'package.json',
        'package-lock.json',
        'tsconfig.base.json',
        'tsconfig.json',
        'apps/gateway',
        'apps/frontend',
        'packages/contracts',
        'packages/config',
        'packages/data',
        'packages/runtime',
        'scripts/goldilocks',
        'infra/docker/Dockerfile.web.dev',
    ],
    live_update=[
        fall_back_on([
            './package.json',
            './package-lock.json',
            './tsconfig.base.json',
            './tsconfig.json',
            './apps/gateway/package.json',
            './apps/frontend/package.json',
            './packages/contracts/package.json',
            './packages/config/package.json',
            './packages/data/package.json',
            './packages/runtime/package.json',
        ]),
        sync('./apps/gateway/src', '/app/apps/gateway/src'),
        sync('./apps/frontend/src', '/app/apps/frontend/src'),
        sync('./apps/frontend/index.html', '/app/apps/frontend/index.html'),
        sync('./apps/frontend/vite.config.ts', '/app/apps/frontend/vite.config.ts'),
        sync('./packages/contracts/src', '/app/packages/contracts/src'),
        sync('./packages/config/src', '/app/packages/config/src'),
        sync('./packages/data/src', '/app/packages/data/src'),
        sync('./packages/runtime/src', '/app/packages/runtime/src'),
        sync('./scripts/goldilocks', '/app/scripts/goldilocks'),
    ],
)

docker_build(
    'goldilocks-agent-service',
    '.',
    dockerfile='infra/docker/Dockerfile.agent-service.dev',
    only=[
        'package.json',
        'package-lock.json',
        'tsconfig.base.json',
        'tsconfig.json',
        'apps/agent-service',
        'packages/contracts',
        'packages/config',
        'packages/data',
        'packages/runtime',
        'infra/docker/Dockerfile.agent-service.dev',
    ],
    live_update=[
        fall_back_on([
            './package.json',
            './package-lock.json',
            './tsconfig.base.json',
            './tsconfig.json',
            './apps/agent-service/package.json',
            './packages/contracts/package.json',
            './packages/config/package.json',
            './packages/data/package.json',
            './packages/runtime/package.json',
        ]),
        sync('./apps/agent-service/src', '/app/apps/agent-service/src'),
        sync('./packages/contracts/src', '/app/packages/contracts/src'),
        sync('./packages/config/src', '/app/packages/config/src'),
        sync('./packages/data/src', '/app/packages/data/src'),
        sync('./packages/runtime/src', '/app/packages/runtime/src'),
    ],
)

# Intentionally omit HPAs in local kind dev to reduce rollout churn and noisy restarts.
k8s_yaml(['infra/k8s/web-app.yaml', 'infra/k8s/agent-service.yaml'])
k8s_resource(
    'web-app',
    port_forwards=['3000:3000', '5173:5173'],
    labels=['app'],
)
k8s_resource(
    'agent-service',
    port_forwards=['3001:3001'],
    labels=['app'],
)

k8s_resource(
    'headlamp',
    port_forwards=['8080:4466'],
    labels=['ops'],
)

local_resource(
    'headlamp-token',
    './ops/headlamp/scripts/generate-headlamp-token.sh',
    deps=[
        'ops/headlamp/scripts/generate-headlamp-token.sh',
        'ops/headlamp/k8s/headlamp-rbac.yaml',
    ],
    resource_deps=['headlamp'],
    labels=['ops'],
)

# ── Agent Image ──
# Not deployed as a k8s resource — web app creates agent pods dynamically.
# docker_build alone won't load into kind (no k8s resource references it),
# so we use local_resource to build + explicitly load into kind.
local_resource(
    'agent-image',
    'docker build -t goldilocks-agent:latest -f infra/docker/Dockerfile.agent . && kind load docker-image goldilocks-agent:latest --name goldilocks',
    deps=['infra/docker/Dockerfile.agent'],
    labels=['build'],
)
