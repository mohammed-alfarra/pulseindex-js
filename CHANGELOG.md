# Changelog

## 1.1.3

No code change. The package now ships only what is needed to use it.

- Source maps are no longer published. They embedded the complete TypeScript
  source of every bundled file and were 59% of the tarball. The shipped
  JavaScript is unminified, so stack traces still land somewhere readable.
- Build, release and proto-sync notes moved out of the README; they described
  how the SDK is maintained, not how to call it.
- The RPC table lists the calls a normal API key can make. The three
  operator-only ones are noted rather than tabulated.

318 KB to 130 KB.

## 1.1.2

Documentation only; the code is identical to 1.1.0.

The vendored `engine.proto` still described how the service works rather than
how to call it. Found by reading the file rather than searching it for known
words — which is the only method that finds what you did not already know to
look for.

## 1.1.1

Documentation only; the code is identical to 1.1.0.

1.1.0 shipped internal maintainer comments in its type declarations and source
maps — `tsup` emits JSDoc into `.d.ts` and embeds the whole TypeScript source
into `.map`, and both are in the tarball. 1.1.0 has been unpublished.

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
