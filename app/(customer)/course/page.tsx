import { redirect } from "next/navigation";

// L'ancien parcours /course est remplacé par le module Coligo Drive.
export default function CoursePage() {
  redirect("/drive");
}
