import { Heading } from "@up/ui";
import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { LoginForm } from "../../../features/auth/components/AuthForms";
import { getAdminContext } from "../../../features/auth/server";

export const metadata: Metadata = { title: "Anmelden" };

export default async function LoginPage() {
  if (await getAdminContext()) redirect("/");
  return (
    <div className="flex flex-col gap-8">
      <Heading level={1} variant="title-lg">
        Anmelden
      </Heading>
      <LoginForm />
    </div>
  );
}
