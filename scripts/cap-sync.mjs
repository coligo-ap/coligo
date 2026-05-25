#!/usr/bin/env node
/**
 * Sync Capacitor avec un env CAPACITOR_ENV donné, sans dépendre de cross-env.
 *
 *   node scripts/cap-sync.mjs prod   # → server.url = https://commercant.coligo.app
 *   node scripts/cap-sync.mjs        # → server.url = https://coligo-liart.vercel.app
 */

import { spawnSync } from "node:child_process";

const env = (process.argv[2] || "").toLowerCase();
const childEnv = { ...process.env };
if (env === "prod") childEnv.CAPACITOR_ENV = "prod";

const cmd = process.platform === "win32" ? "npx.cmd" : "npx";
const res = spawnSync(cmd, ["cap", "sync", "android"], {
  stdio: "inherit",
  env: childEnv,
});
process.exit(res.status ?? 1);
