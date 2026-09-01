# Changelog

## 1.1.0

### `health()` no longer reports false for every key

`health()` used an operator-only call that customer API keys are not permitted to
make. The permission error was caught and turned into `false`, so the method
reported an unusable service no matter how healthy it actually was.

It now uses the standard `grpc.health.v1.Health` protocol, which requires no
particular scope. The signature is unchanged. If you were working around this by
ignoring `health()`, you can stop.

### Added

- `client.servingStatus(service?)` — the raw serving status, for telling
  "reachable but not serving" apart from "no answer at all". Defaults to `''`,
  the overall-server name from the health spec.
- `SERVING_STATUS` — the status constants, exported from the package root.
- `healthProtoPath` on the client config, for the rare case of overriding the
  bundled `health.proto`.

`proto/health.proto` now ships with the package. It is the standard health
protocol, vendored rather than pulled in as a dependency.

### Compatibility

Against a service deployed before this release, the health protocol answers but
always reports `SERVING`. `health()` is then equivalent to a reachability check.

## 1.0.0

Initial release.
