#!/usr/bin/env node
/**
 * Compare the vendored `proto/engine.proto` against the engine's own copy.
 *
 * This is the only check that can detect the engine moving ahead of this SDK —
 * the failure that left `needs_full_reindex` unobserved while `health()`
 * reported a degraded engine as healthy. It needs the engine source, so it
 * SKIPS (exit 0) when the engine is absent, which is the case in this
 * repository's CI: the engine is a separate private repository.
 *
 * Structural drift *within* this repository is covered unconditionally by
 * `tests/ProtoSchema.test.ts`, which does run in CI.
 *
 *   npm run check:proto
 *   PULSEINDEX_PROTO=/path/to/engine/proto/engine.proto npm run check:proto
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { diffProtoSchemas, parseProtoSchema } from './protoSchema.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const VENDORED = join(ROOT, 'proto', 'engine.proto');

const explicit = process.env.PULSEINDEX_PROTO;
let source;

if (explicit) {
  // An explicitly configured path that does not exist is a misconfiguration.
  // Falling through to a sibling checkout would hide it.
  if (!existsSync(explicit)) {
    console.error(`error: PULSEINDEX_PROTO is set to a path that does not exist: ${explicit}`);
    process.exit(1);
  }
  source = explicit;
} else {
  const candidates = [
    join(ROOT, '..', 'pulseindex-engine', 'proto', 'engine.proto'),
    join(ROOT, '..', 'PulseIndex', 'proto', 'engine.proto'),
  ];
  source = candidates.find((p) => existsSync(p));
  if (!source) {
    console.log('note: engine proto not found — skipping the engine comparison.');
    for (const c of candidates) console.log(`      checked: ${c}`);
    console.log('      set PULSEINDEX_PROTO, or check out the engine beside this repo.');
    console.log('      tests/ProtoSchema.test.ts still guards the vendored schema itself.');
    process.exit(0);
  }
}

const engineText = readFileSync(source, 'utf8');
const vendorText = readFileSync(VENDORED, 'utf8');

const schemaDiff = diffProtoSchemas(parseProtoSchema(engineText), parseProtoSchema(vendorText));

if (schemaDiff.length > 0) {
  console.error('error: vendored proto/engine.proto is out of sync with the engine.');
  console.error(`       engine:   ${source}`);
  console.error(`       vendored: ${VENDORED}`);
  console.error('');
  console.error('       schema differences (engine -> vendored):');
  for (const line of schemaDiff) console.error(`         ${line}`);
  console.error('');
  console.error(`       fix: cp ${source} proto/engine.proto`);
  console.error('       then update the fixture in tests/ProtoSchema.test.ts so the change is');
  console.error('       visible in review, and check whether PulseIndexClient must read any');
  console.error('       new or renamed field — it reads by name with `?? default` fallbacks,');
  console.error('       so a missed field is silent at runtime.');
  process.exit(1);
}

// Same schema. Flag textual drift (comments, ordering) as a warning only: it
// does not break the client, but the copies should stay identical.
const normalise = (t) => t.replace(/\r\n/g, '\n').replace(/[ \t]+$/gm, '').trimEnd();
if (normalise(engineText) !== normalise(vendorText)) {
  console.log(`ok: schema matches the engine (${source})`);
  console.log('warning: the files differ textually (comments or ordering) though the schema');
  console.log(`         is identical. Re-sync when convenient: cp ${source} proto/engine.proto`);
  process.exit(0);
}

console.log(`ok: vendored proto is identical to the engine (${source})`);
