"use client";

import Link from "next/link";
import { useState, useActionState } from "react";
import { ArrowLeft, Loader2 } from "lucide-react";
import { VIOLET } from "@/components/customer/drive/drive-modals";
import {
  chauffeurLogin,
  chauffeurSignup,
  type ChauffeurAuthState,
} from "@/app/(chauffeur)/actions";

const initial: ChauffeurAuthState = {};

/**
 * Connexion / Inscription chauffeur (maquette s-dauth) : onglets, téléphone +
 * mot de passe ; inscription = nom*, prénom*, tél*, date de naissance*,
 * wilaya/ville*, mot de passe*, GAMME du véhicule.
 */
export function DAuth({ tab: initialTab = "log" }: { tab?: "log" | "reg" }) {
  const [tab, setTab] = useState<"log" | "reg">(initialTab);
  const [gamme, setGamme] = useState<"classic" | "confort" | "moto">("classic");
  const [loginState, loginAction, loginPending] = useActionState(
    chauffeurLogin,
    initial
  );
  const [regState, regAction, regPending] = useActionState(
    chauffeurSignup,
    initial
  );

  const inp =
    "mb-2 w-full rounded-[14px] border border-[var(--d-line)] bg-[var(--d-soft)] px-3.5 py-3 text-sm font-semibold outline-none placeholder:font-medium placeholder:text-[var(--d-muted)]";

  return (
    <div className="drive-jakarta drive-page h-full bg-[var(--d-surface)] px-5 pt-5 pb-28">
      {/* Retour : accueil marketplace (la nav du bas étant fixe, ce lien
          reste le retour visible immédiatement). */}
      <Link
        href="/"
        className="mb-3 inline-flex items-center gap-1.5 text-[13px] font-bold text-[var(--d-muted)]"
      >
        <ArrowLeft className="size-4" />
        Retour
      </Link>
      <div className="mb-4 text-center">
        <h1 className="drive-sora text-[22px] font-extrabold tracking-[-0.5px]">
          Coligo <span style={{ color: VIOLET }}>Drive</span>
        </h1>
        <p className="mt-0.5 text-[13px] text-[var(--d-muted)]">
          Espace chauffeur
        </p>
      </div>

      <div className="mb-3 flex gap-2">
        {(
          [
            ["log", "Connexion"],
            ["reg", "Inscription"],
          ] as const
        ).map(([k, label]) => (
          <button
            key={k}
            type="button"
            onClick={() => setTab(k)}
            className="flex-1 rounded-[12px] border-[1.5px] px-1.5 py-2.5 text-xs font-bold"
            style={
              tab === k
                ? { borderColor: VIOLET, background: "#EEEEFD", color: VIOLET }
                : { borderColor: "var(--d-line)", color: "var(--d-muted)" }
            }
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "log" ? (
        <form action={loginAction}>
          <input
            name="phone"
            type="tel"
            required
            placeholder="Téléphone (07 / 06 / 05...)"
            className={inp}
          />
          <input
            name="password"
            type="password"
            required
            placeholder="Mot de passe"
            className={inp}
          />
          {loginState.error && (
            <p
              className="mb-2 rounded-[12px] px-3 py-2 text-center text-xs font-bold"
              style={{ background: "rgba(229,72,77,.1)", color: "#E5484D" }}
            >
              {loginState.error}
            </p>
          )}
          <button
            type="submit"
            disabled={loginPending}
            className="drive-sora mt-1 flex h-[54px] w-full items-center justify-center gap-2 rounded-[17px] text-base font-bold text-white disabled:opacity-60"
            style={{
              background: VIOLET,
              boxShadow: `0 14px 28px -12px ${VIOLET}`,
            }}
          >
            {loginPending && <Loader2 className="size-5 animate-spin" />}
            Se connecter
          </button>
        </form>
      ) : (
        <form action={regAction}>
          <input
            name="last_name"
            required
            placeholder="Nom *"
            className={inp}
          />
          <input
            name="first_name"
            required
            placeholder="Prénom *"
            className={inp}
          />
          <input
            name="phone"
            type="tel"
            required
            placeholder="Téléphone *"
            className={inp}
          />
          <input
            name="birth_date"
            type="date"
            required
            aria-label="Date de naissance"
            className={inp}
          />
          <input
            name="city"
            required
            placeholder="Wilaya / Ville *"
            className={inp}
          />
          <input
            name="password"
            type="password"
            required
            placeholder="Mot de passe *"
            className={inp}
          />
          <p className="mt-1 mb-2 text-[13px] font-bold">
            Votre véhicule (gamme)
          </p>
          <input type="hidden" name="gamme" value={gamme} />
          <div className="mb-3 flex gap-2">
            {(
              [
                ["classic", "Classic"],
                ["confort", "Confort"],
                ["moto", "Moto"],
              ] as const
            ).map(([k, label]) => (
              <button
                key={k}
                type="button"
                onClick={() => setGamme(k)}
                className="flex-1 rounded-[12px] border-[1.5px] px-1.5 py-2.5 text-xs font-bold"
                style={
                  gamme === k
                    ? {
                        borderColor: VIOLET,
                        background: "#EEEEFD",
                        color: VIOLET,
                      }
                    : { borderColor: "var(--d-line)", color: "var(--d-muted)" }
                }
              >
                {label}
              </button>
            ))}
          </div>
          {regState.error && (
            <p
              className="mb-2 rounded-[12px] px-3 py-2 text-center text-xs font-bold"
              style={{ background: "rgba(229,72,77,.1)", color: "#E5484D" }}
            >
              {regState.error}
            </p>
          )}
          <button
            type="submit"
            disabled={regPending}
            className="drive-sora flex h-[54px] w-full items-center justify-center gap-2 rounded-[17px] text-base font-bold text-white disabled:opacity-60"
            style={{
              background: VIOLET,
              boxShadow: `0 14px 28px -12px ${VIOLET}`,
            }}
          >
            {regPending && <Loader2 className="size-5 animate-spin" />}
            Continuer · mes documents
          </button>
        </form>
      )}
    </div>
  );
}
