import { redirect } from "next/navigation";

export default function Home() {
  // Entry point. We land on the automation builder (/new), which is usable
  // without auth so the app is demoable before Supabase keys are configured.
  // Once auth is wired, this can point to /dashboard instead.
  redirect("/new");
}
