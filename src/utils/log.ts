// All logging goes to stderr. stdout is reserved for the report.

export function log(msg: string) {
  process.stderr.write(`[contxt] ${msg}\n`);
}

export function error(msg: string) {
  process.stderr.write(`[contxt] ERROR: ${msg}\n`);
}

export function debug(msg: string) {
  if (process.env.CONTXT_DEBUG) {
    process.stderr.write(`[contxt] DEBUG: ${msg}\n`);
  }
}
