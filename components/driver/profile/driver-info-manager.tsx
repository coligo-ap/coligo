"use client";

import { useLocale } from "next-intl";
import {
  VehicleSection,
  DocsSection,
  PayoutsSection,
  RequestHistory,
} from "./driver-info-sections";
import type {
  SelfVehicle,
  SelfDoc,
  SelfPayout,
  SelfRequest,
} from "./driver-info-shared";

// Chemin d'import stable (driver-info-section importe les types d'ici).
export type {
  SelfVehicle,
  SelfDoc,
  SelfPayout,
  SelfRequest,
} from "./driver-info-shared";

export function DriverInfoManager({
  verified,
  vehicle,
  documents,
  payouts,
  requests,
}: {
  verified: boolean;
  vehicle: SelfVehicle;
  documents: SelfDoc[];
  payouts: SelfPayout[];
  requests: SelfRequest[];
}) {
  const isAr = useLocale() === "ar";
  const pendingKinds = new Set(
    requests.filter((r) => r.status === "pending").map((r) => r.kind)
  );
  return (
    <>
      <div className="acc-grp">{isAr ? "معلوماتي" : "Mes informations"}</div>

      {!verified && (
        <div
          className="card"
          style={{ borderColor: "var(--violet)", marginBottom: 14 }}
        >
          <b style={{ color: "var(--violet)" }}>
            {isAr ? "أكمل ملفك الشخصي" : "Complétez votre profil"}
          </b>
          <p style={{ fontSize: 12.5, color: "var(--muted)", marginTop: 4 }}>
            {isAr
              ? "أدخل بيانات مركبتك ووثائقك وطريقة التسديد. كل شيء يبقى «قيد التحقق» حتى موافقة كوليغو. بعد التوثيق، كل تعديل جديد يمرّ عبر طلب."
              : "Renseignez votre véhicule, vos pièces et votre versement. Tout est « en cours de vérification » jusqu'à validation par Coligo. Une fois vérifié, chaque nouvelle modification repassera par une demande."}
          </p>
        </div>
      )}

      <VehicleSection
        vehicle={vehicle}
        verified={verified}
        pending={pendingKinds.has("vehicle")}
      />
      <DocsSection documents={documents} />
      <PayoutsSection
        payouts={payouts}
        verified={verified}
        pending={pendingKinds.has("payout")}
      />

      {requests.length > 0 && <RequestHistory requests={requests} />}
    </>
  );
}

// ---------------- Véhicule ----------------
