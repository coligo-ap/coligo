import { CustomerQueryProvider } from "@/components/customer/customer-query-provider";

/**
 * Layout de groupe CLIENT — hôte PERSISTANT du cache TanStack Query (il ne se
 * re-monte pas en naviguant entre pages client, donc le QueryClient survit). Ne
 * touche pas au chrome (chaque page garde son CustomerShell), n'ajoute qu'un
 * provider de contexte invisible.
 */
export default function CustomerGroupLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <CustomerQueryProvider>{children}</CustomerQueryProvider>;
}
