import { PARTNER_FONT_VARS } from "@/lib/fonts";

export default function DriveLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <div className={`${PARTNER_FONT_VARS} drive-jakarta`}>{children}</div>;
}
