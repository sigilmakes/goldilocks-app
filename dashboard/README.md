# Dashboard

This directory contains the backend deployment for the Goldilocks ops dashboard.

## Current implementation

The dashboard backend is a stock [Headlamp](https://headlamp.dev/) deployment running inside the `goldilocks` namespace.

- **Runtime**: upstream `ghcr.io/headlamp-k8s/headlamp` image
- **Scope**: Goldilocks-first dashboard; namespace actions plus minimal cluster read for stock Headlamp overview
- **Auth**: in-cluster `ServiceAccount`
- **Actions allowed**: read namespace resources, view logs, exec into pods, delete pods
- **Extra cluster read**: `nodes`, `namespaces`, and `nodes.metrics.k8s.io` so the stock overview page works
- **Local access**: Tilt port-forward to `http://localhost:8080`

## Layout

- `k8s/headlamp.yaml` — Headlamp deployment and ClusterIP service
- `k8s/headlamp-rbac.yaml` — dedicated ServiceAccount, Role, and RoleBinding

## Usage

Start the stack with Tilt:

```bash
tilt up
```

Then open:

- Headlamp: http://localhost:8080

Tilt also generates a dev login token automatically at:

```bash
.dev/headlamp-token.txt
```

To print it:

```bash
cat .dev/headlamp-token.txt
```

To regenerate it:

```bash
tilt trigger headlamp-token
```

This directory is intentionally minimal for v1: upstream Headlamp, minimal RBAC, no plugins, no wrapper UI.
