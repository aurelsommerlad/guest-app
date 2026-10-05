import { createNavigation } from "next-intl/navigation";

import { routing } from "./routing";

/** Locale-aware navigation helpers: hrefs are written without the locale prefix ("/stay"). */
export const { Link, redirect, usePathname, useRouter, getPathname } = createNavigation(routing);
