import { notFound } from "next/navigation";
import type { ReactNode } from "react";

import { serverEnv } from "../../env/server";
import { documentMetadata, documentViewport } from "../_components/document-metadata";
import { RootDocument } from "../_components/RootDocument";

export const metadata = documentMetadata;
export const viewport = documentViewport;
import { isDesignLabEnabled } from "./design-lab";

/** Root layout of the internal Design Lab. Guards every /dev route: 404 in production. */
export default function DevLayout({ children }: Readonly<{ children: ReactNode }>) {
  if (!isDesignLabEnabled(serverEnv.APP_ENV)) {
    notFound();
  }
  return <RootDocument lang="de">{children}</RootDocument>;
}
