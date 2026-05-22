"use client";

import { useState } from "react";
import { MerchantMobileBottomNav } from "@/components/merchant/mobile-bottom-nav";
import { MobileDrawer } from "@/components/merchant/mobile-drawer";

/**
 * Navigation mobile commerçant : bottom-nav (4 actions) + drawer latéral pour
 * les sections secondaires. L'état ouvert/fermé est partagé ici.
 * Caché sur desktop (la sidebar fixe prend le relais).
 */
export function MobileNav({
  merchantName,
  email,
}: {
  merchantName: string;
  email: string;
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <MerchantMobileBottomNav
        onOpenMenu={() => setOpen(true)}
        menuOpen={open}
      />
      <MobileDrawer
        open={open}
        onClose={() => setOpen(false)}
        merchantName={merchantName}
        email={email}
      />
    </>
  );
}
