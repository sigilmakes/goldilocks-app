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
---
apiVersion: v1
kind: Secret
metadata:
  name: api-keys
  namespace: goldilocks
type: Opaque
stringData:
  anthropic: "%s"
  openai: "%s"
  google: "%s"
""" % (os.getenv('ANTHROPIC_API_KEY', ''), os.getenv('OPENAI_API_KEY', ''), os.getenv('GOOGLE_API_KEY', ''))))

# ── k8s Infrastructure ──
# Namespace and RBAC must exist before the web-app deployment.
k8s_yaml([
    'k8s/namespace.yaml',
    'k8s/rbac.yaml',
    'k8s/network-policies.yaml',
    'k8s/resource-quota.yaml',
])

# ── Web App ──
docker_build(
    'goldilocks-web',
    '.',
    dockerfile='deploy/docker/Dockerfile.web.dev',
    live_update=[
        # Deps: full rebuild when package files change (must be first)
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

        # Shared types (server imports via symlink, frontend via relative path)
        sync('./shared', '/app/shared'),

        # Goldilocks CLI stub
        sync('./bin', '/app/bin'),

        # Skills and agent context
        sync('./skills', '/app/skills'),
        sync('./AGENTS.md', '/app/AGENTS.md'),
    ],
)

k8s_yaml('k8s/web-app.yaml')
k8s_resource(
    'web-app',
    port_forwards=['3000:3000', '5173:5173'],
    labels=['app'],
)

# ── Agent Image ──
# Not deployed as a k8s resource — web app creates agent pods dynamically.
# Tilt just builds the image so it's available in kind.
docker_build(
    'goldilocks-agent',
    '.',
    dockerfile='deploy/docker/Dockerfile.agent',
)
