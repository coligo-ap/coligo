"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { announcementsChannel } from "@/lib/realtime/broadcast";
import { useResumeResync } from "@/lib/hooks/use-resume-resync";
import {
  DEFAULT_LOCALE,
  LOCALE_COOKIE,
  isLocale,
  type Locale,
} from "@/i18n/locale";
import {
  AnnouncementPopup,
  type AnnouncementAction,
  type AnnouncementData,
} from "@/components/shared/announcement-popup";

// =============================================================================
// AnnouncementHost — monté UNE fois dans la coque de chaque espace (client,
// commerçant, livreur, chauffeur). Règles :
//   • démarrage ASYNCHRONE après le paint (ne ralentit jamais l'ouverture) ;
//   • une seule pop-up à la fois, BLOQUANTES d'abord (tri serveur) ;
//   • mode `route` : visible seulement si le pathname commence par le préfixe ;
//   • « instantané » : canal broadcast PUBLIC `announcements:{role}` → refetch
//     (+ resync à la reprise arrière-plan — règle du repo) ;
//   • OFFLINE-FIRST : reçus via RPC idempotente ; échec réseau → file
//     localStorage rejouée à `online`/reprise ; ids traités cachés localement
//     (une annonce fermée ne réapparaît JAMAIS, même hors ligne).
// =============================================================================

type HostItem = AnnouncementData & {
  popup_mode: "next_open" | "instant" | "route";
  route_prefix: string | null;
};

type QueuedReceipt = {
  id: string;
  event: "seen" | "ack" | "dismiss" | "click";
  button: number | null;
};

function doneKey(uid: string) {
  return `coligo:ann:done:${uid}`;
}
function queueKey(uid: string) {
  return `coligo:ann:queue:${uid}`;
}
function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}
function writeJson(key: string, value: unknown) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* stockage indisponible : dégradation silencieuse */
  }
}

function readLocale(): Locale {
  try {
    const m = document.cookie.match(
      new RegExp(`(?:^|; )${LOCALE_COOKIE}=([^;]*)`)
    );
    const v = m ? decodeURIComponent(m[1]) : null;
    return isLocale(v) ? v : DEFAULT_LOCALE;
  } catch {
    return DEFAULT_LOCALE;
  }
}

export function AnnouncementHost({
  role,
}: {
  role: "customer" | "merchant" | "driver" | "chauffeur";
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [queue, setQueue] = useState<HostItem[]>([]);
  const [locale, setLocale] = useState<Locale>(DEFAULT_LOCALE);
  const uidRef = useRef<string | null>(null);
  const seenSent = useRef<Set<string>>(new Set());
  const [nonce, setNonce] = useState(0);

  useEffect(() => setLocale(readLocale()), [pathname]);

  /** Envoie un reçu — file locale rejouable si le réseau échoue. */
  const sendReceipt = useCallback(
    async (
      id: string,
      event: QueuedReceipt["event"],
      button: number | null
    ) => {
      const uid = uidRef.current;
      try {
        const supabase = createClient();
        // RPC hors types générés → bind OBLIGATOIRE (reference_supabase_rpc_bind).
        const rpc = supabase.rpc.bind(supabase) as unknown as (
          fn: string,
          args: Record<string, unknown>
        ) => Promise<{ error: { message: string } | null }>;
        const { error } = await rpc("announcement_receipt", {
          p_id: id,
          p_event: event,
          p_button: button,
        });
        if (error) throw new Error(error.message);
      } catch {
        if (!uid) return;
        const q = readJson<QueuedReceipt[]>(queueKey(uid), []);
        q.push({ id, event, button });
        writeJson(queueKey(uid), q.slice(-50));
      }
    },
    []
  );

  /** Rejoue la file offline (idempotent côté serveur — rejouable à l'infini). */
  const flushQueue = useCallback(async () => {
    const uid = uidRef.current;
    if (!uid) return;
    const q = readJson<QueuedReceipt[]>(queueKey(uid), []);
    if (q.length === 0) return;
    writeJson(queueKey(uid), []);
    for (const r of q) await sendReceipt(r.id, r.event, r.button);
  }, [sendReceipt]);

  const fetchAnnouncements = useCallback(async () => {
    try {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return;
      uidRef.current = user.id;
      await flushQueue();

      const rpc = supabase.rpc.bind(supabase) as unknown as (
        fn: string
      ) => Promise<{ data: HostItem[] | null }>;
      const { data } = await rpc("my_announcements");
      const done = new Set(readJson<string[]>(doneKey(user.id), []));
      setQueue((data ?? []).filter((a) => !done.has(a.id)));
    } catch {
      /* silencieux : prochain déclencheur (bump / reprise) réessaiera */
    }
  }, [flushQueue]);

  // Démarrage APRÈS le paint — jamais bloquant pour l'ouverture de l'app.
  useEffect(() => {
    const tid = setTimeout(() => void fetchAnnouncements(), 1200);
    return () => clearTimeout(tid);
  }, [fetchAnnouncements, nonce]);

  // « Instantané » : canal public par rôle + resync reprise (nonce en dép →
  // ré-abonnement après un passage en arrière-plan).
  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel(announcementsChannel(role))
      .on("broadcast", { event: "bump" }, () => void fetchAnnouncements())
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [role, fetchAnnouncements, nonce]);
  useResumeResync(() => setNonce((n) => n + 1));

  // Retour réseau → rejoue les accusés en attente.
  useEffect(() => {
    const onOnline = () => void flushQueue();
    window.addEventListener("online", onOnline);
    return () => window.removeEventListener("online", onOnline);
  }, [flushQueue]);

  // Une seule pop-up : la première de la file qui correspond à la page.
  const current = queue.find(
    (a) =>
      a.popup_mode !== "route" ||
      (a.route_prefix != null && pathname.startsWith(a.route_prefix))
  );

  // Impression (une fois par annonce et par session).
  useEffect(() => {
    if (current && !seenSent.current.has(current.id)) {
      seenSent.current.add(current.id);
      void sendReceipt(current.id, "seen", null);
    }
  }, [current, sendReceipt]);

  if (!current) return null;

  const finish = (id: string) => {
    const uid = uidRef.current;
    if (uid) {
      const done = readJson<string[]>(doneKey(uid), []);
      if (!done.includes(id))
        writeJson(doneKey(uid), [...done, id].slice(-100));
    }
    setQueue((q) => q.filter((a) => a.id !== id));
  };

  const onAction = (action: AnnouncementAction) => {
    if (action.kind === "close") {
      void sendReceipt(current.id, "dismiss", null);
      finish(current.id);
      return;
    }
    const btn = current.buttons[action.index];
    if (!btn) return;
    switch (btn.action) {
      case "acknowledge":
        void sendReceipt(current.id, "ack", null);
        break;
      case "dismiss":
        void sendReceipt(current.id, "dismiss", null);
        break;
      case "redirect_internal":
        void sendReceipt(current.id, "click", action.index);
        if (btn.target?.startsWith("/")) router.push(btn.target);
        break;
      case "redirect_external":
        void sendReceipt(current.id, "click", action.index);
        if (btn.target)
          window.open(btn.target, "_blank", "noopener,noreferrer");
        break;
    }
    finish(current.id);
  };

  return (
    <AnnouncementPopup
      announcement={current}
      locale={locale}
      onAction={onAction}
    />
  );
}
