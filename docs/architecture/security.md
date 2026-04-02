# Security

## Authentication

- **JWT tokens** with 7-day expiry. Secret must be set via `JWT_SECRET` in production.
- **bcrypt** password hashing with automatic salt.
- **Rate limiting** on auth endpoints (20 requests per 15 minutes) and API endpoints (60/min in production, 300/min in dev).

## API Key Storage

User API keys are encrypted at rest using **AES-256-GCM**:

```mermaid
graph LR
    User["User enters API key"] -->|"HTTPS"| Server["Express Server"]
    Server -->|"encrypt(key)"| DB["SQLite<br/>iv:authTag:ciphertext"]
    DB -->|"decrypt(row)"| Pod["Agent Pod env var<br/>ANTHROPIC_API_KEY=sk-..."]
```

- Encryption key derived from `ENCRYPTION_KEY` config via SHA-256
- Each key has a unique 16-byte IV
- Authentication tag prevents tampering
- Keys are decrypted only when creating/restarting a user's pod

No server-level API keys — users always bring their own.

## Container Isolation

Each user runs in their own k8s pod with:

| Control | Setting |
|---------|---------|
| Non-root | `runAsUser: 1000`, `runAsGroup: 1000` |
| No privilege escalation | `allowPrivilegeEscalation: false` |
| Dropped capabilities | `capabilities: { drop: ['ALL'] }` |
| Filesystem isolation | Each user's home is a separate hostPath |
| No service account | `automountServiceAccountToken: false` |

The init container runs as root solely to `chown` the hostPath directory for uid 1000. The main container cannot escalate.

## Path Traversal Protection

File operations go through k8s exec — the web app never touches the user's filesystem directly. The exec commands use sanitised filenames:

```typescript
const safeName = filename.replace(/[^a-zA-Z0-9._-]/g, '_');
```

## Network

Currently no network policies are enforced in dev. Production should restrict agent pods to:
- DNS resolution (kube-dns)
- External HTTPS (model provider APIs)
- Nothing else (no inter-pod, no internal services)

## Secrets Management

Dev secrets are generated inline by the Tiltfile — no manual `kubectl create secret` needed. Production secrets must be created out-of-band:

```bash
kubectl create secret generic app-secrets \
  --from-literal=jwt-secret=$(openssl rand -hex 32) \
  --from-literal=encryption-key=$(openssl rand -hex 32) \
  -n goldilocks
```
