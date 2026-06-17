"use client";

/**
 * Sons livreur — « mise en ligne » (playGo) et « nouvelle commande »
 * (playNewOrder). Stratégie demandée par le prompt : essayer d'abord un FICHIER
 * audio court (public/sounds/online.mp3 / new-order.mp3) ; en cas d'absence ou
 * d'échec, repli sur la SYNTHÈSE Web Audio (portée À L'IDENTIQUE des fonctions
 * playGo()/playNewOrder() des maquettes). Tout est best-effort et silencieux en
 * cas d'erreur (autoplay bloqué, AudioContext indispo…).
 *
 * Tous les sons respectent la préférence livreur « Sons » (sound-store) : si le
 * livreur a coupé le son, les `play*` sont des no-op (la vibration, canal
 * séparé, reste gérée par l'appelant).
 */

import { isDriverSoundOn } from "@/lib/driver/sound-store";

// Aucun fichier mp3 n'est livré pour l'instant (public/sounds/ absent) : on va
// DIRECTEMENT à la synthèse Web Audio. Tenter de charger les .mp3 inexistants
// générait des 404 répétés en console. Repasser à `true` le jour où des fichiers
// audio sont ajoutés dans public/sounds/.
const USE_SOUND_FILES = false;

function tryFile(src: string): Promise<boolean> {
  if (!USE_SOUND_FILES) return Promise.resolve(false);
  return new Promise((resolve) => {
    try {
      const a = new Audio(src);
      a.volume = 0.6;
      a.addEventListener("error", () => resolve(false), { once: true });
      const p = a.play();
      if (p && typeof p.then === "function") {
        p.then(() => resolve(true)).catch(() => resolve(false));
      } else {
        resolve(true);
      }
    } catch {
      resolve(false);
    }
  });
}

function ctx(): AudioContext | null {
  try {
    const A =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext })
        .webkitAudioContext;
    return new A();
  } catch {
    return null;
  }
}

/** Repli synthèse : arpège majeur ascendant + accord final (cf. maquette). */
function synthGo() {
  const ac = ctx();
  if (!ac) return;
  const now = ac.currentTime;
  const m = ac.createGain();
  m.gain.value = 0.5;
  m.connect(ac.destination);
  const sw = ac.createOscillator();
  const sg = ac.createGain();
  sw.type = "sawtooth";
  sw.frequency.setValueAtTime(180, now);
  sw.frequency.exponentialRampToValueAtTime(520, now + 0.12);
  sg.gain.setValueAtTime(0.0001, now);
  sg.gain.exponentialRampToValueAtTime(0.22, now + 0.03);
  sg.gain.exponentialRampToValueAtTime(0.0001, now + 0.16);
  sw.connect(sg);
  sg.connect(m);
  sw.start(now);
  sw.stop(now + 0.18);
  [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => {
    const t = now + 0.12 + i * 0.085;
    const o = ac.createOscillator();
    const g = ac.createGain();
    o.type = "triangle";
    o.frequency.value = f;
    o.connect(g);
    g.connect(m);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.55, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.3);
    o.start(t);
    o.stop(t + 0.32);
  });
  const tc = now + 0.12 + 4 * 0.085;
  [1046.5, 1318.5, 1568].forEach((f) => {
    const o = ac.createOscillator();
    const g = ac.createGain();
    o.type = "triangle";
    o.frequency.value = f;
    o.connect(g);
    g.connect(m);
    g.gain.setValueAtTime(0.0001, tc);
    g.gain.exponentialRampToValueAtTime(0.4, tc + 0.03);
    g.gain.exponentialRampToValueAtTime(0.0001, tc + 0.7);
    o.start(tc);
    o.stop(tc + 0.75);
  });
  setTimeout(() => ac.close().catch(() => {}), 1600);
}

/** Repli synthèse : double « ding-ding » clair + sparkle (cf. maquette). */
function synthNewOrder() {
  const ac = ctx();
  if (!ac) return;
  const now = ac.currentTime;
  const m = ac.createGain();
  m.gain.value = 0.6;
  m.connect(ac.destination);
  const seq: [number, number][] = [
    [987.77, 0],
    [987.77, 0.18],
    [1318.5, 0.36],
  ];
  seq.forEach(([f, d]) => {
    const t = now + d;
    const o = ac.createOscillator();
    const g = ac.createGain();
    const o2 = ac.createOscillator();
    const g2 = ac.createGain();
    o.type = "sine";
    o.frequency.value = f;
    o2.type = "triangle";
    o2.frequency.value = f * 1.5;
    g2.gain.value = 0.25;
    o2.connect(g2);
    g2.connect(g);
    o.connect(g);
    g.connect(m);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.6, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.28);
    o.start(t);
    o.stop(t + 0.3);
    o2.start(t);
    o2.stop(t + 0.3);
  });
  const ts = now + 0.56;
  [1760, 2093].forEach((f, i) => {
    const o = ac.createOscillator();
    const g = ac.createGain();
    o.type = "sine";
    o.frequency.value = f;
    o.connect(g);
    g.connect(m);
    const t = ts + i * 0.05;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.3, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.4);
    o.start(t);
    o.stop(t + 0.42);
  });
  setTimeout(() => ac.close().catch(() => {}), 1300);
}

/** Repli synthèse : double bip GRAVE descendant (alerte/annulation). */
function synthAlert() {
  const ac = ctx();
  if (!ac) return;
  const now = ac.currentTime;
  const m = ac.createGain();
  m.gain.value = 0.6;
  m.connect(ac.destination);
  // Deux bips descendants (440 → 330 Hz), timbre carré « buzzer ».
  const seq: [number, number][] = [
    [440, 0],
    [330, 0.22],
  ];
  seq.forEach(([f, d]) => {
    const t = now + d;
    const o = ac.createOscillator();
    const g = ac.createGain();
    o.type = "square";
    o.frequency.setValueAtTime(f, t);
    o.frequency.exponentialRampToValueAtTime(f * 0.85, t + 0.18);
    o.connect(g);
    g.connect(m);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.5, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.2);
    o.start(t);
    o.stop(t + 0.22);
  });
  setTimeout(() => ac.close().catch(() => {}), 700);
}

export async function playGo() {
  if (!isDriverSoundOn()) return;
  if (await tryFile("/sounds/online.mp3")) return;
  synthGo();
}

/** Alerte (course annulée, incident) — fichier alert.mp3 sinon synthèse. */
export async function playAlert() {
  if (!isDriverSoundOn()) return;
  if (await tryFile("/sounds/alert.mp3")) return;
  synthAlert();
}

export async function playNewOrder() {
  if (!isDriverSoundOn()) return;
  if (await tryFile("/sounds/new-order.mp3")) return;
  synthNewOrder();
}
