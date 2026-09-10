/**
 * Loads .env into process.env. server.ts imports this first, ahead of every
 * other module.
 *
 * It has to be its own module. Imports are hoisted, so a loadEnvFile() call in
 * server.ts's body ran only after every imported module had evaluated — and
 * db/index.ts reads DATABASE_PATH at import time, so a path set in .env was
 * silently ignored.
 */
try {
  process.loadEnvFile();
} catch {
  // No .env file — variables come from the environment (on the server,
  // systemd's EnvironmentFile).
}
