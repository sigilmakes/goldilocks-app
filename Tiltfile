# -*- mode: Python -*-

update_settings(suppress_unused_image_warnings=['goldilocks-agent'])

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
    'k8s/namespace.yaml',
    'k8s/rbac.yaml',
    'dashboard/k8s/headlamp-rbac.yaml',
    'dashboard/k8s/headlamp.yaml',
])

# ── Web App ──
docker_build(
    'goldilocks-web',
    '.',
    dockerfile='deploy/docker/Dockerfile.web.dev',
    live_update=[
        # Deps: full rebuild when package files change
        fall_back_on([
            './package.json',
            './server/package.json',
            './frontend/package.json',
            './package-lock.json',
        ]),

        # Frontend: sync source files, Vite HMR handles the rest
        sync('./frontend/src', '/app/frontend/src'),
        sync('./frontend/index.html', '/app/frontend/index.html'),
        sync('./frontend/vite.config.ts', '/app/frontend/vite.config.ts'),

        # Server: sync source, tsx watch auto-restarts
        sync('./server/src', '/app/server/src'),

        # Shared types
        sync('./shared', '/app/shared'),
    ],
)

docker_build(
    'goldilocks-agent-service',
    '.',
    dockerfile='deploy/docker/Dockerfile.agent-service.dev',
    live_update=[
        fall_back_on([
            './package.json',
            './server/package.json',
            './agent-service/package.json',
            './package-lock.json',
        ]),
        sync('./agent-service/src', '/app/agent-service/src'),
        sync('./server/src', '/app/server/src'),
    ],
)

k8s_yaml(['k8s/web-app.yaml', 'k8s/agent-service.yaml', 'k8s/web-app-hpa.yaml', 'k8s/agent-service-hpa.yaml'])
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
    './dashboard/scripts/generate-headlamp-token.sh',
    deps=[
        'dashboard/scripts/generate-headlamp-token.sh',
        'dashboard/k8s/headlamp-rbac.yaml',
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
    'docker build -t goldilocks-agent:latest -f deploy/docker/Dockerfile.agent . && kind load docker-image goldilocks-agent:latest --name goldilocks',
    deps=['deploy/docker/Dockerfile.agent'],
    labels=['build'],
)
