import { notFound } from "next/navigation";
import type { ReactNode } from "react";

import { serverEnv } from "../../env/server";
import { isDesignLabEnabled } from "./design-lab";

/** Guards every /dev route: responds with 404 in production. */
export default function DevLayout({ children }: Readonly<{ children: ReactNode }>) {
  if (!isDesignLabEnabled(serverEnv.APP_ENV)) {
    notFound();
  }
  return children;
}
