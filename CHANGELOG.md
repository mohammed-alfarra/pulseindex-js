# Changelog

## 2.0.0

### Breaking: the operator-only methods are gone

Three methods that no API key could ever call have been removed, along with
their types. Every attempt returned a permission error, so nothing that worked
before stops working. If you were calling them and handling the failure, that
is the code to delete.

**Checking readiness:** use `health()`, or `servingStatus()` when you need to
tell "not answering" apart from "not reachable". Both work with any key.

### `health()` no longer reports false for every key

`health()` returned `false` no matter how the service was actually doing. It
now uses the standard `grpc.health.v1.Health` protocol. The signature is
unchanged — if you were working around this by ignoring `health()`, you can
stop.

### Added

- `client.servingStatus(service?)` — the raw serving status, for telling
  "reachable but not serving" apart from "no answer at all". Defaults to `''`,
  the overall-server name from the health spec.
- `SERVING_STATUS` — the status constants, exported from the package root.
- `healthProtoPath` on the client config, for the rare case of overriding the
  bundled `health.proto`.

`proto/health.proto` ships with the package. It is the standard health
protocol, vendored rather than pulled in as a dependency.

### Compatibility

Against a service deployed before this release, the health protocol answers but
always reports `SERVING`. `health()` is then equivalent to a reachability check.

## Earlier versions

1.x was withdrawn and is not installable. 2.0.0 is the first supported release.
