/**
 * Harnais one-command pour les tests E2E offline (Playwright).
 *   npm run test:offline:e2e:serve
 *
 * Démarre `next start` (PRÉREQUIS : `npm run build` au préalable), attend que
 * l'app réponde, lance scripts/test-offline-e2e.mjs contre elle, puis arrête le
 * serveur (arbre de process inclus sous Windows). Utilise le Chrome système.
 */
import { spawn, spawnSync } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { existsSync } from "node:fs";

const PORT = process.env.E2E_PORT || "3100";
const BASE = `http://localhost:${PORT}`;

if (!existsSync(".next")) {
  console.error("✗ Build absent. Lance d'abord : npm run build");
  process.exit(1);
}

console.log(`▶ Démarrage de next start sur le port ${PORT}…`);
const server = spawn("npx", ["next", "start", "-p", PORT], {
  stdio: "ignore",
  shell: true,
});

async function waitReady() {
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(`${BASE}/offline`);
      if (r.status === 200) return true;
    } catch {
      /* pas encore prêt */
    }
    await sleep(1000);
  }
  return false;
}

function killServer() {
  try {
    if (process.platform === "win32") {
      // `next start` est ré-parenté → tuer par PORT est plus fiable que par PID.
      // spawnSync (bloquant) pour que le kill s'achève AVANT process.exit().
      spawnSync(
        "powershell.exe",
        [
          "-NonInteractive",
          "-Command",
          `Get-NetTCPConnection -LocalPort ${PORT} -State Listen -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique | ForEach-Object { taskkill /pid $_ /t /f }`,
        ],
        { stdio: "ignore" }
      );
    } else {
      server.kill("SIGTERM");
    }
  } catch {
    /* déjà mort */
  }
}

let code = 1;
try {
  if (!(await waitReady())) {
    console.error("✗ Le serveur n'a pas répondu à temps.");
  } else {
    console.log("✓ Serveur prêt — lancement des tests E2E.\n");
    code = await new Promise((resolve) => {
      const t = spawn("node", ["scripts/test-offline-e2e.mjs"], {
        stdio: "inherit",
        shell: true,
        env: { ...process.env, E2E_BASE_URL: BASE },
      });
      t.on("exit", (c) => resolve(c ?? 1));
    });
  }
} finally {
  killServer();
}
process.exit(code);
