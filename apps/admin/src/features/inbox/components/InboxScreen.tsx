import { can, type ConversationChannel, hasAllProperties } from "@up/core";
import {
  type ConversationDetail,
  type ConversationListItem,
  getConversationDetail,
  inboxChangeMarker,
  listConversations,
  markConversationRead,
} from "@up/db";
import { cx, Icon } from "@up/ui";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { type AdminContext } from "../../auth/admin-auth-service";
import { principalOf } from "../../auth/authorization";
import { requireAdmin } from "../../auth/server";
import { getTenantProperties } from "../../property-context/server";
import { loadReservationSummary } from "../../../server/apaleo-services";
import { assignAction, setStatusAction, simulateMessagesAction } from "../actions";
import { assignableMembers, inboxScopeFor, parseInboxFilter } from "../inbox-service";
import {
  CHANNEL_LABELS,
  CHANNEL_MARKS,
  DELIVERY_ERROR_LABELS,
  DELIVERY_LABELS,
  EVENT_LABELS,
  KIND_LABELS,
  listTime,
  messageTime,
  STATUS_LABELS,
  stayDate,
} from "../labels";
import { inboxDeps } from "../server";
import { Composer } from "./Composer";
import { InboxRefresher } from "./InboxRefresher";

export type InboxSearch = {
  channel?: string;
  status?: string;
  unread?: string;
  assignee?: string;
  notice?: string;
  error?: string;
};

function query(search: InboxSearch, change: Partial<InboxSearch> = {}): string {
  const merged = { ...search, ...change, notice: undefined, error: undefined };
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(merged)) if (value) params.set(key, value);
  const text = params.toString();
  return text ? `?${text}` : "";
}

function FilterLink({
  href,
  active,
  children,
}: {
  href: string;
  active: boolean;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      aria-current={active ? "true" : undefined}
      className={cx(
        "type-small inline-flex min-h-11 shrink-0 items-center border-b md:min-h-9",
        active ? "border-text text-text" : "border-transparent text-text-muted hover:text-text",
      )}
    >
      {children}
    </Link>
  );
}

function Filters({ base, search }: { base: string; search: InboxSearch }) {
  const status = search.status;
  return (
    <nav aria-label="Filter" className="flex flex-col gap-1 pb-3">
      <div className="-mx-4 flex gap-5 overflow-x-auto px-4 md:mx-0 md:px-0">
        <FilterLink
          href={`${base}${query(search, { status: undefined, unread: undefined })}`}
          active={!status && !search.unread}
        >
          Alle
        </FilterLink>
        <FilterLink
          href={`${base}${query(search, { unread: "1", status: undefined })}`}
          active={search.unread === "1"}
        >
          Ungelesen
        </FilterLink>
        <FilterLink
          href={`${base}${query(search, { status: "open", unread: undefined })}`}
          active={status === "open"}
        >
          Offen
        </FilterLink>
        <FilterLink
          href={`${base}${query(search, { status: "pending", unread: undefined })}`}
          active={status === "pending"}
        >
          Wartet
        </FilterLink>
        <FilterLink
          href={`${base}${query(search, { status: "done", unread: undefined })}`}
          active={status === "done"}
        >
          Erledigt
        </FilterLink>
      </div>
      <form method="get" action={base} className="flex flex-wrap items-center gap-3">
        {search.status && <input type="hidden" name="status" value={search.status} />}
        {search.unread && <input type="hidden" name="unread" value={search.unread} />}
        <label className="type-caption flex items-center gap-2 text-text-muted">
          <span>Kanal</span>
          <select
            name="channel"
            defaultValue={search.channel ?? ""}
            className="type-small min-h-11 border-b border-border bg-transparent text-text md:min-h-9"
          >
            <option value="">Alle Kanäle</option>
            {(Object.keys(CHANNEL_LABELS) as ConversationChannel[]).map((channel) => (
              <option key={channel} value={channel}>
                {CHANNEL_LABELS[channel]}
              </option>
            ))}
          </select>
        </label>
        <label className="type-caption flex items-center gap-2 text-text-muted">
          <span>Zuständig</span>
          <select
            name="assignee"
            defaultValue={search.assignee ?? ""}
            className="type-small min-h-11 border-b border-border bg-transparent text-text md:min-h-9"
          >
            <option value="">Alle</option>
            <option value="me">Mir zugewiesen</option>
            <option value="none">Nicht zugewiesen</option>
          </select>
        </label>
        <button type="submit" className="type-small min-h-11 text-text underline md:min-h-9">
          Anwenden
        </button>
      </form>
    </nav>
  );
}

function ConversationList({
  items,
  selectedId,
  search,
  propertyNames,
  now,
}: {
  items: ConversationListItem[];
  selectedId?: string;
  search: InboxSearch;
  propertyNames: Map<string, string>;
  now: Date;
}) {
  if (items.length === 0) {
    return (
      <p className="type-small border-t border-border py-8 text-text-muted">
        Keine Unterhaltungen für diese Auswahl.
      </p>
    );
  }
  return (
    <ul className="border-t border-border" data-testid="conversation-list">
      {items.map((item) => (
        <li key={item.id} className="border-b border-border">
          <Link
            href={`/inbox/c/${item.id}${query(search)}`}
            aria-current={item.id === selectedId ? "page" : undefined}
            data-unread={item.unread ? "true" : "false"}
            className={cx(
              "grid grid-cols-[2.25rem_minmax(0,1fr)_auto] gap-x-3 py-4 pr-1",
              item.id === selectedId ? "bg-surface" : "hover:bg-surface",
            )}
          >
            <span
              className="type-caption mt-0.5 flex h-6 items-center justify-center border border-border text-text-muted"
              title={CHANNEL_LABELS[item.channel]}
              aria-label={CHANNEL_LABELS[item.channel]}
            >
              {CHANNEL_MARKS[item.channel]}
            </span>
            <span className="min-w-0">
              <span
                className={cx("type-body block truncate text-text", item.unread && "font-semibold")}
              >
                {item.title}
              </span>
              <span className="type-caption block truncate text-text-muted">
                {CHANNEL_LABELS[item.channel]}
                {item.propertyId
                  ? ` · ${propertyNames.get(item.propertyId) ?? item.propertyId}`
                  : " · ohne Objekt"}
                {item.kind === "inquiry" ? " · Anfrage" : ""}
              </span>
              {item.lastMessagePreview && (
                <span className="type-small mt-1 line-clamp-2 text-text-muted">
                  {item.lastMessagePreview}
                </span>
              )}
            </span>
            <span className="flex flex-col items-end gap-1.5">
              <span className="type-caption whitespace-nowrap text-text-muted">
                {listTime(item.lastMessageAt, now)}
              </span>
              {item.unread && (
                <span className="block size-2 bg-text" aria-label="Ungelesen" role="img" />
              )}
              {item.status !== "open" && (
                <span className="type-caption text-text-muted">
                  {item.status === "done" ? "Erledigt" : "Wartet"}
                </span>
              )}
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

function MessageItem({
  message,
  authorNames,
  channelLabel,
}: {
  message: ConversationDetail["messages"][number];
  authorNames: Map<string, string>;
  channelLabel: string;
}) {
  const author =
    message.direction === "inbound"
      ? (message.senderName ?? "Gast")
      : message.authorAdminUserId
        ? (authorNames.get(message.authorAdminUserId) ?? "Team")
        : "Team";
  const status =
    message.direction === "outbound" && message.deliveryStatus
      ? (DELIVERY_LABELS[message.deliveryStatus] ?? message.deliveryStatus)
      : null;
  return (
    <article
      data-direction={message.direction}
      data-delivery={message.deliveryStatus ?? ""}
      className={cx(
        "py-5",
        message.direction === "outbound" && "ml-6 border-l border-text pl-4 md:ml-20",
        message.direction === "internal" && "ml-6 bg-surface px-4 md:ml-20",
      )}
    >
      <header className="type-caption flex flex-wrap items-baseline gap-x-2 text-text-muted">
        <span className="type-eyebrow text-text">
          {message.direction === "internal" ? "Interne Notiz" : author}
        </span>
        {message.direction === "internal" && <span>{author}</span>}
        <span>{messageTime(message.createdAt)}</span>
        {message.direction === "inbound" && <span>· {channelLabel}</span>}
      </header>
      <p className="type-body mt-2 whitespace-pre-wrap text-text">{message.body}</p>
      {status && (
        <p
          className={cx(
            "type-caption mt-2",
            message.deliveryStatus === "failed" || message.deliveryStatus === "uncertain"
              ? "text-text"
              : "text-text-muted",
          )}
          data-testid="delivery-status"
        >
          {message.deliveryStatus === "failed" && (
            <Icon name="info" size="sm" className="mr-1 inline" />
          )}
          {status}
          {message.deliveryErrorCode &&
            ` – ${DELIVERY_ERROR_LABELS[message.deliveryErrorCode] ?? message.deliveryErrorCode}`}
        </p>
      )}
    </article>
  );
}

async function ContextPanel({
  admin,
  detail,
  propertyNames,
  members,
}: {
  admin: AdminContext;
  detail: ConversationDetail;
  propertyNames: Map<string, string>;
  members: { id: string; label: string }[];
}) {
  const c = detail.conversation;
  const principal = principalOf(admin);
  const canAssign = c.propertyId
    ? can(principal, "inbox.assign", { propertyId: c.propertyId })
    : hasAllProperties(principal) && can(principal, "inbox.assign");
  const reservationLink = detail.reservations[0];
  const reservation = reservationLink
    ? await loadReservationSummary(reservationLink.externalReservationId)
    : undefined;
  const assignee = members.find((m) => m.id === c.assignedAdminUserId);
  return (
    <div className="flex flex-col gap-8" data-testid="context-panel">
      <section className="flex flex-col gap-3">
        <h2 className="type-eyebrow text-text-muted">Reservierung</h2>
        {reservationLink ? (
          <dl className="type-small grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1.5">
            <dt className="text-text-muted">Nummer</dt>
            <dd className="text-text">{reservationLink.externalReservationId}</dd>
            {reservation ? (
              <>
                <dt className="text-text-muted">Anreise</dt>
                <dd className="text-text">{stayDate(reservation.arrival)}</dd>
                <dt className="text-text-muted">Abreise</dt>
                <dd className="text-text">{stayDate(reservation.departure)}</dd>
                <dt className="text-text-muted">Gäste</dt>
                <dd className="text-text">
                  {reservation.adults} Erw.
                  {reservation.children ? `, ${String(reservation.children)} Kind` : ""}
                </dd>
                <dt className="text-text-muted">Status</dt>
                <dd className="text-text">{reservation.status}</dd>
              </>
            ) : (
              <dd className="col-span-2 text-text-muted">
                Live-Daten aus Apaleo gerade nicht verfügbar.
              </dd>
            )}
          </dl>
        ) : (
          <p className="type-small text-text-muted">
            {c.kind === "inquiry"
              ? "Anfrage ohne Buchung."
              : "Noch keiner Reservierung zugeordnet."}
          </p>
        )}
        {reservation && <p className="type-caption text-text-muted">Quelle: Apaleo (live)</p>}
      </section>

      {detail.related.length > 0 && (
        <section className="flex flex-col gap-2">
          <h2 className="type-eyebrow text-text-muted">Weitere Unterhaltungen</h2>
          <ul className="type-small flex flex-col gap-1">
            {detail.related.map((r) => (
              <li key={r.id}>
                <Link
                  href={`/inbox/c/${r.id}`}
                  className="text-text underline-offset-4 hover:underline"
                >
                  {CHANNEL_LABELS[r.channel]} · {r.title}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="flex flex-col gap-3">
        <h2 className="type-eyebrow text-text-muted">Bearbeitung</h2>
        <p className="type-small text-text">
          {STATUS_LABELS[c.status]} · {assignee ? assignee.label : "nicht zugewiesen"}
        </p>
        {canAssign && (
          <>
            <div className="flex flex-wrap gap-2">
              {(["open", "pending", "done"] as const)
                .filter((status) => status !== c.status)
                .map((status) => (
                  <form key={status} action={setStatusAction}>
                    <input type="hidden" name="conversationId" value={c.id} />
                    <input type="hidden" name="currentStatus" value={c.status} />
                    <input type="hidden" name="status" value={status} />
                    <button
                      type="submit"
                      className="type-small min-h-11 border border-text px-3 md:min-h-9"
                    >
                      {status === "done"
                        ? "Erledigt"
                        : status === "open"
                          ? "Wieder öffnen"
                          : "Wartet auf Gast"}
                    </button>
                  </form>
                ))}
            </div>
            <form action={assignAction} className="flex flex-wrap items-center gap-2">
              <input type="hidden" name="conversationId" value={c.id} />
              <input type="hidden" name="currentAssignee" value={c.assignedAdminUserId ?? ""} />
              <label className="sr-only" htmlFor={`assignee-${c.id}`}>
                Zuweisen an
              </label>
              <select
                id={`assignee-${c.id}`}
                name="assignee"
                defaultValue={c.assignedAdminUserId ?? ""}
                className="type-small min-h-11 min-w-0 flex-1 border-b border-border bg-transparent md:min-h-9"
              >
                <option value="">Nicht zugewiesen</option>
                {members.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.id === admin.adminUserId ? `${m.label} (ich)` : m.label}
                  </option>
                ))}
              </select>
              <button type="submit" className="type-small min-h-11 underline md:min-h-9">
                Zuweisen
              </button>
            </form>
          </>
        )}
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="type-eyebrow text-text-muted">Verlauf</h2>
        <ol className="type-caption flex flex-col gap-1 text-text-muted">
          {detail.events.slice(0, 8).map((event, index) => (
            <li key={`${event.createdAt.toISOString()}-${String(index)}`}>
              {messageTime(event.createdAt)} · {EVENT_LABELS[event.type] ?? event.type}
            </li>
          ))}
        </ol>
      </section>

      <p className="type-caption text-text-muted">
        {CHANNEL_LABELS[c.channel]} · {KIND_LABELS[c.kind] ?? c.kind}
        {c.propertyId ? ` · ${propertyNames.get(c.propertyId) ?? c.propertyId}` : ""}
        {c.channelEnvironment === "simulated" ? " · Simulation" : ""}
      </p>
    </div>
  );
}

/**
 * Unified Inbox (ADR 0023). Desktop: list, conversation and reservation context side by side;
 * mobile: the list, or the conversation in full screen with a back link.
 */
export async function InboxScreen({
  propertyId,
  conversationId,
  search,
}: {
  propertyId?: string;
  conversationId?: string;
  search: InboxSearch;
}) {
  const admin = await requireAdmin();
  const scope = inboxScopeFor(admin);
  if (!scope) redirect("/forbidden");
  const deps = inboxDeps();
  const properties = await getTenantProperties();
  if (propertyId && !properties.some((p) => p.id === propertyId)) notFound();
  const propertyNames = new Map(properties.map((p) => [p.id, p.displayName]));
  const filter = parseInboxFilter(search);

  let detail: ConversationDetail | undefined;
  if (conversationId) {
    detail = await getConversationDetail(deps.db, scope, conversationId);
    if (!detail) notFound();
    await markConversationRead(deps.db, scope, { conversationId, at: deps.now() });
  }
  const [items, marker] = await Promise.all([
    listConversations(deps.db, scope, { ...filter, ...(propertyId ? { propertyId } : {}) }),
    inboxChangeMarker(deps.db, scope),
  ]);
  const listBase = propertyId ? `/inbox/${propertyId}` : "/inbox";
  const now = deps.now();
  const principal = principalOf(admin);
  const members = detail
    ? await assignableMembers(deps, admin, detail.conversation.propertyId)
    : [];
  const authorNames = new Map(members.map((m) => [m.id, m.label]));
  const conversationProperty = detail?.conversation.propertyId;
  const canReply = Boolean(
    detail &&
    (conversationProperty
      ? can(principal, "inbox.reply", { propertyId: conversationProperty })
      : hasAllProperties(principal) && can(principal, "inbox.reply")),
  );
  const canNote = Boolean(
    detail &&
    (conversationProperty
      ? can(principal, "inbox.notes", { propertyId: conversationProperty })
      : hasAllProperties(principal) && can(principal, "inbox.notes")),
  );

  return (
    <div data-testid="inbox" className="-mt-2 lg:-mt-4">
      <InboxRefresher marker={marker.latest} intervalMs={detail ? 5000 : 15000} />
      {search.error && (
        <p role="alert" className="type-small mb-4 border-l border-text pl-3 text-text">
          {search.error}
        </p>
      )}
      <div
        className={cx(
          "lg:grid lg:gap-10",
          detail
            ? "lg:grid-cols-[20rem_minmax(0,1fr)] xl:grid-cols-[21rem_minmax(0,1fr)_17rem]"
            : "lg:grid-cols-[20rem_minmax(0,1fr)] xl:grid-cols-[21rem_minmax(0,1fr)]",
        )}
      >
        <section
          aria-label="Unterhaltungen"
          className={cx(
            "lg:sticky lg:top-24 lg:max-h-[calc(100dvh-7rem)] lg:overflow-y-auto",
            detail && "hidden lg:block",
          )}
        >
          <header className="flex items-baseline justify-between gap-4 pb-2">
            <h1 className="type-title text-text">Posteingang</h1>
            <span className="flex items-baseline gap-4">
              {marker.unread > 0 && (
                <span className="type-caption text-text-muted" data-testid="unread-count">
                  {marker.unread} ungelesen
                </span>
              )}
              <Link href="/inbox/devices" className="type-caption text-text-muted underline">
                Mitteilungen
              </Link>
            </span>
          </header>
          <Filters base={listBase} search={search} />
          <ConversationList
            items={items}
            selectedId={conversationId}
            search={search}
            propertyNames={propertyNames}
            now={now}
          />
          {deps.simulation && can(principal, "inbox.manage") && (
            <form action={simulateMessagesAction} className="py-6">
              <button type="submit" className="type-small min-h-11 underline">
                Simulierte Gästenachrichten erzeugen
              </button>
              <p className="type-caption text-text-muted">
                Nur Test/Staging · keine echten Gäste, keine Kanäle.
              </p>
            </form>
          )}
        </section>

        {detail ? (
          <section aria-label="Unterhaltung" className="min-w-0" data-testid="conversation">
            <header className="flex flex-col gap-1 border-b border-text pb-4">
              <Link
                href={`${listBase}${query(search)}`}
                className="type-small -ml-1 inline-flex min-h-11 items-center gap-1 self-start text-text-muted lg:hidden"
              >
                <Icon name="arrow-left" size="sm" /> Posteingang
              </Link>
              <p className="type-eyebrow text-text-muted">
                {CHANNEL_LABELS[detail.conversation.channel]}
                {detail.conversation.propertyId
                  ? ` · ${propertyNames.get(detail.conversation.propertyId) ?? detail.conversation.propertyId}`
                  : ""}
              </p>
              <h2 className="type-title-lg text-text">{detail.conversation.title}</h2>
              <p className="type-small text-text-muted">
                {STATUS_LABELS[detail.conversation.status]}
                {detail.conversation.kind === "inquiry" ? " · Anfrage ohne Buchung" : ""}
                {detail.conversation.reservationIds[0]
                  ? ` · Reservierung ${detail.conversation.reservationIds[0]}`
                  : ""}
              </p>
            </header>
            <details className="border-b border-border py-3 xl:hidden">
              <summary className="type-small min-h-11 cursor-pointer text-text md:min-h-0">
                Reservierung &amp; Bearbeitung
              </summary>
              <div className="pt-4">
                <ContextPanel
                  admin={admin}
                  detail={detail}
                  propertyNames={propertyNames}
                  members={members}
                />
              </div>
            </details>
            <div className="divide-y divide-border" data-testid="messages">
              {detail.messages.map((message) => (
                <MessageItem
                  key={message.id}
                  message={message}
                  authorNames={authorNames}
                  channelLabel={CHANNEL_LABELS[detail.conversation.channel]}
                />
              ))}
            </div>
            <Composer
              conversationId={detail.conversation.id}
              channelHint={`Über ${CHANNEL_LABELS[detail.conversation.channel]}${
                detail.conversation.channelEnvironment === "simulated"
                  ? " · Simulation, kein echter Versand"
                  : ""
              }`}
              canReply={canReply && detail.conversation.channelEnvironment === "simulated"}
              canNote={canNote}
            />
          </section>
        ) : (
          <div className="hidden min-h-80 items-center justify-center border-t border-border lg:flex">
            <p className="type-small text-text-muted">Wähle links eine Unterhaltung.</p>
          </div>
        )}

        {detail && (
          <aside
            aria-label="Kontext"
            className="hidden xl:block xl:sticky xl:top-24 xl:max-h-[calc(100dvh-7rem)] xl:overflow-y-auto"
          >
            <ContextPanel
              admin={admin}
              detail={detail}
              propertyNames={propertyNames}
              members={members}
            />
          </aside>
        )}
      </div>
    </div>
  );
}
