import { DAuth } from "@/components/chauffeur/d-auth";
import { CustomerBottomNav } from "@/components/customer/customer-bottom-nav";
import { AuthFooter, AuthNavBar } from "@/components/shared/auth-nav";

export const dynamic = "force-dynamic";
export const metadata = { title: "Coligo Drive · Inscription chauffeur" };

export default function ChauffeurSignupPage() {
  return (
    <div className="flex min-h-screen flex-col">
      <AuthNavBar variant="chauffeur" />
      <main className="mx-auto w-full max-w-md flex-1">
        <DAuth tab="reg" />
      </main>
      <AuthFooter />
      <CustomerBottomNav />
    </div>
  );
}
