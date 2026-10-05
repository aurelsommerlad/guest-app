import { Heading, Text } from "@up/ui";
import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { serverEnv } from "../../../env/server";
import { isSetupAvailable } from "../../../features/auth/admin-auth-service";
import { SetupForm } from "../../../features/auth/components/AuthForms";
import { authDeps } from "../../../features/auth/server";

export const metadata: Metadata = { title: "Ersteinrichtung" };
export const dynamic = "force-dynamic";

/** One-time creation of the first admin account – gone as soon as one exists. */
export default async function SetupPage() {
  if (!(await isSetupAvailable(authDeps(), serverEnv.ADMIN_SETUP_TOKEN))) notFound();
  return (
    <div className="flex flex-col gap-6">
      <Heading level={1} variant="title-lg">
        Ersteinrichtung
      </Heading>
      <Text tone="muted">
        Lege das erste Admin-Konto an. Danach ist diese Seite nicht mehr erreichbar; entferne den
        Einrichtungsschlüssel anschließend aus der Server-Konfiguration.
      </Text>
      <SetupForm />
    </div>
  );
}
