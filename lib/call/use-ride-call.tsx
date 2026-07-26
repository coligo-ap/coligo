"use client";

// La machine d'appel a été GÉNÉRALISÉE (course Drive + commande commerçant→
// client) dans use-inapp-call.tsx — ce fichier ne fait que ré-exporter le
// wrapper historique pour ne pas toucher les imports existants
// (d-course.tsx, drive-ride-enroute.tsx).
export { useRideCall } from "@/lib/call/use-inapp-call";
