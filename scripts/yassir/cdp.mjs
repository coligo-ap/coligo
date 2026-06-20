// Mini-client CDP brut (WebSocket natif Node 22) ciblé sur UNE page.
// Évite l'énumération Playwright (30 onglets) qui timeout.

export async function listTargets() {
  const r = await fetch("http://127.0.0.1:9222/json");
  return await r.json();
}

export class CDP {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    this.handlers = [];
    ws.addEventListener("message", (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        msg.error
          ? reject(new Error(JSON.stringify(msg.error)))
          : resolve(msg.result);
      } else if (msg.method) {
        for (const h of this.handlers) h(msg.method, msg.params);
      }
    });
  }
  static async attach(wsUrl) {
    const ws = new WebSocket(wsUrl);
    await new Promise((res, rej) => {
      ws.addEventListener("open", res, { once: true });
      ws.addEventListener("error", rej, { once: true });
    });
    return new CDP(ws);
  }
  send(method, params = {}) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error("timeout " + method));
        }
      }, 30000);
    });
  }
  on(fn) {
    this.handlers.push(fn);
  }
  close() {
    try {
      this.ws.close();
    } catch {}
  }
}

export async function findYassirPage() {
  const targets = await listTargets();
  // priorité : page mobility-app yassir (pas /auth)
  let t = targets.find(
    (x) => x.type === "page" && /mobility-app\.yassir\.com\/fr\?/.test(x.url)
  );
  if (!t)
    t = targets.find(
      (x) => x.type === "page" && /mobility-app\.yassir\.com/.test(x.url)
    );
  return t;
}
