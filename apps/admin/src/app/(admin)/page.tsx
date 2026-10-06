import { redirect } from "next/navigation";

import { getRememberedPropertyId } from "../../features/property-context/server";
import { adminModules, moduleHref } from "../../navigation";

/**
 * Start page. There is no dashboard yet (no operational data without fake numbers), so the
 * admin opens the first working module in the remembered property context.
 */
export default async function AdminHome() {
  const start = adminModules[0];
  if (!start) redirect("/properties");
  redirect(moduleHref(start, await getRememberedPropertyId()));
}
