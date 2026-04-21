# Dashboard

This directory contains the backend deployment for the Goldilocks ops dashboard.

## Current implementation

The dashboard backend is a stock [Headlamp](https://headlamp.dev/) deployment running inside the `goldilocks` namespace.

- **Runtime**: upstream `ghcr.io/headlamp-k8s/headlamp` image
- **Headlamp pod auth**: in-cluster `headlamp` service account with minimal Goldilocks-focused permissions
- **Dev login auth**: Tilt generates a separate `headlamp-admin` token bound to `cluster-admin` so the stock Headlamp UI works without RBAC dead ends
- **Local access**: Tilt port-forward to `http://localhost:8080`

## Layout

- `k8s/headlamp.yaml` — Headlamp deployment and ClusterIP service
- `k8s/headlamp-rbac.yaml` — runtime service account plus dev login service account and RBAC bindings

## Usage

Start the stack with Tilt:

```bash
tilt up
```

Then open:

- Headlamp: http://localhost:8080

Tilt also generates a dev login token automatically. The default
location is:

```
.dev/headlamp/headlamp-token.txt
```

To print it:

```bash
cat .dev/headlamp/headlamp-token.txt
```

To regenerate it:

```bash
tilt trigger headlamp-token
```

The dev token is short-lived. If Headlamp has been idle for a while and suddenly cannot talk to the cluster, the usual culprit is an expired dev login token. In that case, trigger the `headlamp-token` resource in Tilt (or run the command above), copy the refreshed token, and log back in. A full `tilt down` / `tilt up` restart should not be necessary.

This directory is intentionally minimal for v1: upstream Headlamp, minimal runtime RBAC, a broad dev login token for local ops, no plugins, no wrapper UI.
