import type { ReactNode } from "react";

import { AdminShell } from "../../components/AdminShell";
import { requireAdmin } from "../../features/auth/server";

/** Everything below requires a valid admin session. */
export default async function AdminLayout({ children }: Readonly<{ children: ReactNode }>) {
  const admin = await requireAdmin();
  return <AdminShell email={admin.email}>{children}</AdminShell>;
}
