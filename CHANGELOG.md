# Changelog

## 1.1.0

### `health()` no longer reports false for every key

`health()` was built on `GetRecoveryState`. That RPC requires the `admin` scope,
and the engine refuses `admin` to any key bound to a tenant — which is every key
the PulseIndex dashboard issues. The call came back `PERMISSION_DENIED`, the
`catch` turned that into `false`, and the method reported an unreachable engine
no matter how healthy it was.

It now asks `grpc.health.v1.Health`, which the engine serves without its auth
interceptor. No credential is sent and none is needed, so it answers for any
key — or none.

Nothing changes in the signature. If you were working around this by ignoring
`health()`, you can stop.

### Added

- `client.servingStatus(service?)` — the raw `grpc.health.v1` status, for
  telling `NOT_SERVING` apart from `SERVICE_UNKNOWN`. Defaults to `''`, the
  overall-server name from the health spec.
- `SERVING_STATUS` — the status constants, exported from the package root.
- `healthProtoPath` on the client config, for the rare case of overriding the
  bundled `health.proto`.

`proto/health.proto` now ships with the package. It is a vendored subset of the
standard health protocol — eleven lines, frozen since 2017, not worth a
dependency.

### Note on degraded engines

An engine that has lost both snapshot generations boots empty and degraded, and
refuses `Search`. Engines from this release onward publish that state on the
health service, so `health()` sees it. Against an older engine the health
service still answers, but its status does not track degraded recovery — it
will report `SERVING` regardless.

## 1.0.0

Initial release.
