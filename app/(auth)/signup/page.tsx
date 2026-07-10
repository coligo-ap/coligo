"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Logo } from "@/components/shared/logo";
import { signup, type AuthState } from "@/app/(merchant)/actions";
import { CategoryMultiSelect } from "@/components/merchant/settings/category-multi-select";
import { APP_CONFIG } from "@/lib/config/app-config";
import { Mail, Lock, Store, ArrowRight, UserRound } from "lucide-react";
import { InstallBanner } from "@/components/pwa/install-banner";
import { AuthFooter, AuthNavBar } from "@/components/shared/auth-nav";
import { AuthModeTabs } from "@/components/shared/auth-mode-tabs";
import { AuthCard } from "@/components/shared/auth-card";
import { ShopLocationPicker } from "@/components/shared/shop-location-picker";

const initialState: AuthState = {};

// Photo professionnelle de fond du panneau marketing (gauche, desktop).
// Différente de la page de connexion. Remplaçable : dépose ton image dans
// public/ et pointe sur "/signup-hero.jpg". Le dégradé reste en secours.
const HERO_IMG =
  "https://images.unsplash.com/photo-1441986300917-64674bd600d8?auto=format&fit=crop&w=1400&q=80";

export default function SignupPage() {
  const [state, formAction, pending] = useActionState(signup, initialState);
  // PHASE 2 : sélection MULTIPLE de types de commerce (la 1re = principale) —
  // un restaurant peut cocher pizzeria + fast-food, une supérette ajouter
  // boulangerie… Statuts admin respectés (serveur revalide).
  const [cats, setCats] = useState<string[]>([]);
  // Emplacement (wilaya + commune + position confirmée) — obligatoire.
  const [locationValid, setLocationValid] = useState(false);

  return (
    <div className="flex min-h-screen flex-col">
      <AuthNavBar variant="merchant" />
      <div className="flex flex-1 flex-col lg:grid lg:grid-cols-5">
        {/* Colonne marketing — photo pro + ombre noire (même traitement que les
            cartes commerçants) + texte en blanc par-dessus. */}
        <aside className="relative hidden flex-col justify-between overflow-hidden p-12 text-white lg:col-span-2 lg:flex">
          {/* Fond de secours (si la photo ne charge pas) */}
          <div
            aria-hidden
            className="from-primary-600 via-primary-700 to-primary-800 absolute inset-0 bg-gradient-to-br"
          />
          {/* Photo professionnelle */}
          <div
            aria-hidden
            className="absolute inset-0 bg-cover bg-center"
            style={{ backgroundImage: `url("${HERO_IMG}")` }}
          />
          {/* Ombre noire (dégradé) pour la lisibilité du texte blanc */}
          <div
            aria-hidden
            className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/55 to-black/35"
          />

          <div className="relative z-10">
            <Logo variant="teal" size="xl" iconOnly className="!gap-0" />
          </div>

          <div className="relative z-10">
            <h1 className="mb-4 text-4xl leading-tight font-bold drop-shadow-md">
              Rejoignez {APP_CONFIG.name}.<br />
              Vendez sans complications.
            </h1>
            <p className="mb-8 text-lg text-white/90 drop-shadow">
              Une plateforme gratuite à l&apos;inscription. Vous ne payez
              qu&apos;une commission sur les commandes.
            </p>

            <div className="grid grid-cols-2 gap-3 text-sm">
              <Stat value="0 DA" label="Inscription" />
              <Stat value="5%" label="Commission" />
              <Stat value="2 min" label="Création de compte" />
              <Stat value="24/7" label="Support" />
            </div>
          </div>

          <p className="relative z-10 text-xs text-white/70">
            © {new Date().getFullYear()} {APP_CONFIG.name}
          </p>
        </aside>

        {/* Formulaire */}
        <AuthCard
          modeTabs={
            <AuthModeTabs
              mode="signup"
              loginHref="/login"
              signupHref="/signup"
            />
          }
          title="Créer mon compte"
          subtitle="30 secondes, et vous recevez vos commandes."
        >
          <form action={formAction} className="space-y-3">
            {/* Nom commerce */}
            <div className="space-y-1.5">
              <Label htmlFor="merchantName">
                Nom du commerce <span className="text-rose-600">*</span>
              </Label>
              <div className="relative">
                <Store className="text-subtle pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2" />
                <Input
                  id="merchantName"
                  name="merchantName"
                  type="text"
                  placeholder="Boulangerie El Karim"
                  required
                  disabled={pending}
                  className="pl-9"
                />
              </div>
            </div>

            {/* Nom & prénom du responsable */}
            <div className="space-y-1.5">
              <Label htmlFor="managerName">
                Nom & prénom du responsable{" "}
                <span className="text-rose-600">*</span>
              </Label>
              <div className="relative">
                <UserRound className="text-subtle pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2" />
                <Input
                  id="managerName"
                  name="managerName"
                  type="text"
                  placeholder="Karim Benali"
                  required
                  disabled={pending}
                  className="pl-9"
                />
              </div>
            </div>

            {/* Types de commerce (multi-sélection cherchable) */}
            <div className="space-y-1.5">
              <Label>Types de commerce</Label>
              <CategoryMultiSelect
                value={cats}
                onChange={setCats}
                disabled={pending}
              />
              <p className="text-subtle text-xs">
                Plusieurs types possibles (ex. pizzeria + fast-food) — le
                premier est votre type principal.
              </p>
            </div>

            {/* Emplacement de la boutique — wilaya + commune → carte
                    focalisée → position exacte confirmée + adresse. */}
            <ShopLocationPicker
              names={{
                wilaya: "wilayaCode",
                commune: "city",
                address: "address",
                lat: "latitude",
                lng: "longitude",
              }}
              initial={{ wilayaCode: "16" }}
              disabled={pending}
              requireConfirm
              onValidityChange={setLocationValid}
            />

            <div className="border-surface-3 border-t pt-4">
              <div className="space-y-1.5">
                <Label htmlFor="email">
                  Email <span className="text-rose-600">*</span>
                </Label>
                <div className="relative">
                  <Mail className="text-subtle pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2" />
                  <Input
                    id="email"
                    name="email"
                    type="email"
                    autoComplete="email"
                    placeholder="vous@exemple.dz"
                    required
                    disabled={pending}
                    className="pl-9"
                  />
                </div>
              </div>

              <div className="mt-3 space-y-1.5">
                <Label htmlFor="password">
                  Mot de passe <span className="text-rose-600">*</span>
                </Label>
                <div className="relative">
                  <Lock className="text-subtle pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2" />
                  <Input
                    id="password"
                    name="password"
                    type="password"
                    autoComplete="new-password"
                    placeholder="Au moins 8 caractères"
                    minLength={8}
                    required
                    disabled={pending}
                    className="pl-9"
                  />
                </div>
              </div>
            </div>

            {state.error && (
              <div className="rounded-[10px] border border-rose-200 bg-rose-50 px-3 py-2.5 text-sm text-rose-800">
                {state.error}
              </div>
            )}

            {state.success && (
              <div className="rounded-[10px] border border-green-200 bg-green-50 px-3 py-2.5 text-sm text-green-800">
                {state.success}
              </div>
            )}

            <Button
              type="submit"
              size="lg"
              className="w-full"
              disabled={pending || !locationValid}
            >
              {pending ? (
                "Création…"
              ) : (
                <>
                  Créer mon compte
                  <ArrowRight className="size-4" />
                </>
              )}
            </Button>
            {!locationValid && (
              <p className="text-subtle text-center text-xs">
                Choisis ta wilaya et ta commune, puis place et confirme la
                position exacte de ta boutique sur la carte.
              </p>
            )}

            <p className="text-muted pt-2 text-center text-xs">
              En vous inscrivant, vous acceptez les{" "}
              <Link
                href="/cgu"
                className="text-primary-700 font-medium hover:underline"
              >
                Conditions générales
              </Link>{" "}
              et la{" "}
              <Link
                href="/confidentialite"
                className="text-primary-700 font-medium hover:underline"
              >
                Politique de confidentialité
              </Link>{" "}
              de {APP_CONFIG.name}.
            </p>
          </form>

          <div className="border-border text-muted mt-6 border-t pt-4 text-center text-xs">
            Tu es livreur ?{" "}
            <Link
              href="/driver/login"
              className="text-primary-700 font-medium hover:underline"
            >
              Se connecter
            </Link>{" "}
            ·{" "}
            <Link
              href="/driver/signup"
              className="text-primary-700 font-medium hover:underline"
            >
              S&apos;inscrire
            </Link>{" "}
            en tant que livreur
          </div>
        </AuthCard>
      </div>
      <AuthFooter />
      {/* Petit popup d'installation, persistant jusqu'à l'install (fermable). */}
      <InstallBanner label="Installer l'application Commerçant" />
    </div>
  );
}

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <div className="rounded-[10px] bg-black/35 p-3 ring-1 ring-white/15 backdrop-blur">
      <div className="text-xl font-bold">{value}</div>
      <div className="text-xs text-white/80">{label}</div>
    </div>
  );
}
