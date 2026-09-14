import { redirect } from "next/navigation";
import { currentSession } from "@/lib/session";

export default async function Root() {
  redirect((await currentSession()) ? "/shipments" : "/login");
}
