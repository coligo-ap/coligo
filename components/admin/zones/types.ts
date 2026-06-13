import type {
  ServiceKind,
  ZoneMode,
  ZoneRole,
  ZoneScope,
} from "@/lib/zones/service-zones";

export type ZoneRuleRow = {
  id: string;
  label: string;
  service: ServiceKind;
  mode: ZoneMode;
  scope: ZoneScope;
  direction: ZoneRole;
  priority: number;
  active: boolean;
  coming_soon: boolean;
  country_code: string | null;
  wilaya_code: string | null;
  commune: string | null;
  center_lat: number | null;
  center_lng: number | null;
  radius_km: number | null;
  polygon: [number, number][] | null;
  note: string | null;
  created_at: string;
};

export type ServiceDefaultRow = {
  service: ServiceKind;
  default_allow: boolean;
  service_active: boolean;
  max_distance_km: number | null;
};

export type ZoneStatRow = {
  service: ServiceKind;
  wilaya_code: string | null;
  commune: string | null;
  cnt: number;
  last_at: string | null;
};
