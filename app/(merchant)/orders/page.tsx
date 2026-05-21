import { redirect } from "next/navigation";

// Le hub des commandes est le tableau de bord (kanban). /orders sert de base
// aux routes /orders/[id] et /orders/validate.
export default function OrdersIndexPage() {
  redirect("/dashboard");
}
