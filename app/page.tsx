import { connection } from "next/server";
import { Home } from "@/components/home";

export default async function Page() {
  // Render per request so proxy.ts can attach a fresh CSP nonce to every script.
  await connection();
  return <Home />;
}
