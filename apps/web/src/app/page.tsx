import { redirect } from "next/navigation"

export default async function HomePage() {
  // Redirect to dashboard - authentication will be handled by middleware
  redirect("/dashboard")
}