import { Icon } from "@up/ui";
import { getTranslations } from "next-intl/server";

import { Link } from "../../i18n/navigation";
import { V2Monogram } from "./glyphs";

/** V2 header: UP monogram │ UNIQUE PLACES, notifications on the right. */
export async function V2Header() {
  const t = await getTranslations("header");
  return (
    <header className="v2-header v2-margin">
      <Link href="/v2" className="v2-brand">
        <V2Monogram />
        <span aria-hidden className="v2-brand-rule" />
        <span className="v2-wordmark">{t("brand")}</span>
      </Link>
      {/* Notifications follow in a later phase (as in the current app). */}
      <button type="button" className="v2-icon-button" aria-label={t("notifications")}>
        <Icon name="bell" width={23} height={23} strokeWidth={1.2} />
      </button>
    </header>
  );
}
