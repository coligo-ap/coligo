"use client";

import { useEffect, useState } from "react";
import {
  getInstalledAppVersion,
  type InstalledVersion,
} from "@/lib/native/app-version";

/**
 * Libellé discret « Coligo v1.0.13 (16) », en bas de la page compte.
 *
 * Ne s'affiche QUE dans l'APK, où la version installée est une vraie
 * information (support, diagnostic d'un bug lié à une ancienne version). Sur le
 * web, `getInstalledAppVersion()` renvoie `null` et rien n'est rendu.
 */
export function AppVersionLabel() {
  const [v, setV] = useState<InstalledVersion | null>(null);

  useEffect(() => {
    let alive = true;
    void getInstalledAppVersion().then((info) => {
      if (alive) setV(info);
    });
    return () => {
      alive = false;
    };
  }, []);

  if (!v) return null;

  return (
    <p className="text-subtle text-caption pt-3 text-center font-medium">
      Coligo v{v.version} ({v.build})
    </p>
  );
}
