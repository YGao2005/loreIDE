// Minimal test that exercises better-sqlite3 inside a pkg-compiled binary.
// Validates: native addon resolution + binding works when shipped as a sidecar.

const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const TMP = path.join(require('os').tmpdir(), `day0-sqlite-${Date.now()}.db`);

try {
  const db = new Database(TMP);
  db.prepare('CREATE TABLE t (id INTEGER PRIMARY KEY, v TEXT)').run();
  db.prepare('INSERT INTO t (v) VALUES (?)').run('hello');
  const row = db.prepare('SELECT v FROM t WHERE id = 1').get();
  if (row && row.v === 'hello') {
    console.log('DAY0_CHECK3_OK');
    process.exit(0);
  }
  console.error('UNEXPECTED_ROW', row);
  process.exit(1);
} catch (e) {
  console.error('BETTER_SQLITE3_FAILED', e && e.message);
  process.exit(2);
} finally {
  try { fs.unlinkSync(TMP); } catch {}
}
