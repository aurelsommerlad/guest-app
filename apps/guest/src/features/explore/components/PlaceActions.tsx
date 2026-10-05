import { buttonStyles, cx, Icon, type IconName } from "@up/ui";
import { getTranslations } from "next-intl/server";

import { type PlaceAction } from "../model";

const icons: Record<PlaceAction["kind"], IconName> = {
  route: "navigation",
  website: "globe",
  call: "phone",
  reserve: "calendar",
};

/** Actions of a place (route, website, call, reserve). The first one is the primary action. */
export async function PlaceActions({ actions }: { actions: readonly PlaceAction[] }) {
  if (actions.length === 0) return null;
  const t = await getTranslations("explore");
  return (
    <ul className="grid grid-cols-1 gap-2 xs:grid-cols-2">
      {actions.map((action, index) => (
        <li key={action.kind}>
          <a
            href={action.href}
            {...(action.external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
            className={cx(buttonStyles(index === 0 ? "primary" : "secondary"), "w-full")}
          >
            <Icon name={icons[action.kind]} size="sm" />
            <span>
              {t(`actions.${action.kind}`)}
              {action.external && <span className="sr-only"> {t("opensInNewWindow")}</span>}
            </span>
          </a>
        </li>
      ))}
    </ul>
  );
}
