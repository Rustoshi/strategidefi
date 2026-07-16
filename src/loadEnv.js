// Minimal, dependency-free env loader for local development.
// Reads `.env.local` (highest precedence) then `.env`. Never overwrites a variable that's
// already set in the real environment. On Vercel, env vars are injected by the platform,
// so if no files exist this is a no-op.
const fs = require('fs');
const path = require('path');

// Highest precedence first — the loader keeps the first value seen for a given key.
const FILES = ['.env.local', '.env'];

let loaded = false;
function loadEnv() {
  if (loaded) return;
  loaded = true;
  for (const name of FILES) {
    const file = path.join(__dirname, '..', name);
    if (!fs.existsSync(file)) continue;
    const text = fs.readFileSync(file, 'utf8');
    for (const raw of text.split(/\r?\n/)) {
      const line = raw.trim();
      if (!line || line.startsWith('#')) continue;
      const eq = line.indexOf('=');
      if (eq === -1) continue;
      const key = line.slice(0, eq).trim();
      let val = line.slice(eq + 1).trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      if (!(key in process.env)) process.env[key] = val;
    }
  }
}

module.exports = loadEnv;
