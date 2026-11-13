import { redirect } from "next/navigation";

import { isAllowed } from "../../features/auth/authorization";
import { requireAdmin } from "../../features/auth/server";
import { getRememberedPropertyId } from "../../features/property-context/server";
import { adminModules, moduleHref } from "../../navigation";

/**
 * Start page. There is no dashboard yet (no operational data without fake numbers), so the
 * admin opens the first working module in the remembered property context.
 */
export default async function AdminHome() {
  // The first module this admin may open (a viewer without message access skips the inbox).
  const admin = await requireAdmin();
  const start = adminModules.find(
    (candidate) => !candidate.permission || isAllowed(admin, candidate.permission),
  );
  if (!start) redirect("/properties");
  redirect(moduleHref(start, await getRememberedPropertyId()));
}
