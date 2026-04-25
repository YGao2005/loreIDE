// @ts-check
import { execSync } from 'node:child_process';
import { mkdirSync, copyFileSync, chmodSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const binDir = join(root, '..', 'src-tauri', 'binaries');
const ext = process.platform === 'win32' ? '.exe' : '';

// `bun build --compile` bundles the entrypoint + all deps into a single
// self-contained executable. `bun:sqlite` is built into the runtime, so there
// is no native addon to smuggle through a snapshot VFS (the @yao-pkg/pkg +
// better-sqlite3 failure mode from the earlier pipeline — Pitfall 2 in
// 05-RESEARCH.md).
//
// --target picks the Bun runtime flavour baked into the binary. We derive it
// from rustc's host-tuple so it matches Tauri's externalBin expectation on the
// same machine. On Apple Silicon: bun-darwin-arm64.

const triple = execSync('rustc --print host-tuple').toString().trim();
if (!triple) {
  throw new Error('rustc --print host-tuple returned empty — is rustc installed?');
}

function bunTargetFor(hostTuple) {
  // Map rustc host tuples → bun --target flavours.
  if (hostTuple === 'aarch64-apple-darwin') return 'bun-darwin-arm64';
  if (hostTuple === 'x86_64-apple-darwin') return 'bun-darwin-x64';
  if (hostTuple === 'x86_64-unknown-linux-gnu') return 'bun-linux-x64';
  if (hostTuple === 'aarch64-unknown-linux-gnu') return 'bun-linux-arm64';
  if (hostTuple === 'x86_64-pc-windows-msvc') return 'bun-windows-x64';
  throw new Error(
    `No bun --target mapping for host tuple "${hostTuple}". Add it to build.mjs.`,
  );
}

const bunTarget = bunTargetFor(triple);
const outPath = join(root, `dist/mcp-server${ext}`);

mkdirSync(join(root, 'dist'), { recursive: true });

execSync(
  `bun build --compile --target=${bunTarget} --outfile=${outPath} src/index.ts`,
  { cwd: root, stdio: 'inherit' },
);

mkdirSync(binDir, { recursive: true });
const dest = join(binDir, `mcp-server-${triple}${ext}`);
copyFileSync(outPath, dest);
chmodSync(dest, 0o755);
console.log(`Built: ${dest}`);
