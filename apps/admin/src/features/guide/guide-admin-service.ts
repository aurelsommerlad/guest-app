/**
 * GUIDE content management (ADR 0013). Framework-free, dependency-injected; every call
 * runs in the admin's TenantContext, and properties/units are checked to belong to it.
 *
 * Content-type-specific editors (e.g. a comfortable Wi-Fi form later) only need to produce
 * the same `GuideContent` – the model and these operations stay unchanged.
 */
import {
  type GuideBlock,
  type GuideContent,
  guideContentSchema,
  type GuideIcon,
  type GuideStatus,
  type GuideTopic,
  guideTopicMetaSchema,
  isEntityKey,
  type LocalizedText,
  type Logger,
  type Property,
  slugify,
  type TenantContext,
  type TranslationState,
  type Unit,
} from "@up/core";
import {
  createGuideOverride,
  createGuideTopic,
  type Database,
  deleteUnpublishedGuideEntry,
  getGuideEntry,
  getPropertyById,
  getUnitsForProperty,
  type GuideEntryRecord,
  listGuideEntriesForProperty,
  setGuideEntryStatus,
  setGuideTopicOrder,
  updateGuideContent,
  updateGuideTopicMeta,
} from "@up/db";

export type GuideAdminDeps = {
  db: Database;
  logger: Logger;
  now: () => Date;
  /** Images must come from this tenant's/property's media storage (or local fixtures). */
  isAllowedImageSrc: (src: string, target: { tenantId: string; propertyId: string }) => boolean;
  /**
   * Checks the stored file behind an image that is new in the saved content (size and
   * content type). Images already stored with the entry are not checked again.
   */
  verifyNewImage: (
    src: string,
    target: { tenantId: string; propertyId: string },
  ) => Promise<boolean>;
};

function imageSources(content: Pick<GuideContent, "heroImage" | "blocks">): string[] {
  return [
    ...(content.heroImage ? [content.heroImage.src] : []),
    ...content.blocks.flatMap((block) => (block.type === "image" ? [block.image.src] : [])),
  ];
}

export type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string };

const fail = (error: string): { ok: false; error: string } => ({ ok: false, error });

export type OverrideSummary = { id: string; unitId: string; unitName: string; status: GuideStatus };

export type TopicSummary = {
  id: string;
  key: string;
  title: LocalizedText;
  status: GuideStatus;
  sortOrder: number;
  scope: { level: "property" } | { level: "unit"; unitId: string; unitName: string };
  overrides: OverrideSummary[];
  englishComplete: boolean;
  hasContent: boolean;
};

export type PropertyGuide = { property: Property; units: Unit[]; topics: TopicSummary[] };

async function propertyOf(
  deps: GuideAdminDeps,
  context: TenantContext,
  propertyId: string,
): Promise<{ property: Property; units: Unit[] } | undefined> {
  const property = await getPropertyById(deps.db, context, propertyId);
  if (!property) return undefined;
  const units = await getUnitsForProperty(deps.db, context, property.id, { includeInactive: true });
  return { property, units };
}

function unitName(units: readonly Unit[], unitId: string): string {
  return units.find((unit) => unit.id === unitId)?.displayName ?? unitId;
}

/** Topics of a property with their apartment overrides, in guest order. */
export async function loadPropertyGuide(
  deps: GuideAdminDeps,
  context: TenantContext,
  propertyId: string,
  options: { includeArchived?: boolean } = {},
): Promise<PropertyGuide | undefined> {
  const owner = await propertyOf(deps, context, propertyId);
  if (!owner) return undefined;
  const entries = await listGuideEntriesForProperty(deps.db, context, propertyId, {
    includeArchived: options.includeArchived ?? false,
  });
  const topics = entries
    .filter(
      (entry): entry is Extract<GuideEntryRecord, { kind: "topic" }> => entry.kind === "topic",
    )
    .map((topic): TopicSummary => ({
      id: topic.id,
      key: topic.key,
      title: topic.title,
      status: topic.status,
      sortOrder: topic.sortOrder,
      scope:
        topic.scope.level === "unit"
          ? {
              level: "unit",
              unitId: topic.scope.unitId,
              unitName: unitName(owner.units, topic.scope.unitId),
            }
          : { level: "property" },
      overrides: entries
        .filter(
          (entry) =>
            entry.kind === "override" && entry.key === topic.key && entry.status !== "archived",
        )
        .map((entry) => {
          const unitId = entry.scope.level === "unit" ? entry.scope.unitId : "";
          return {
            id: entry.id,
            unitId,
            unitName: unitName(owner.units, unitId),
            status: entry.status,
          };
        })
        .sort((a, b) => a.unitName.localeCompare(b.unitName)),
      englishComplete: topic.translationState.en === "reviewed",
      hasContent: topic.blocks.length > 0 || Boolean(topic.intro),
    }));
  return { ...owner, topics };
}

/** An entry with its property/units – only if it belongs to the admin's tenant. */
export async function loadGuideEntry(
  deps: GuideAdminDeps,
  context: TenantContext,
  entryId: string,
) {
  const entry = await getGuideEntry(deps.db, context, entryId);
  if (!entry || entry.scope.level === "tenant") return undefined;
  const owner = await propertyOf(deps, context, entry.scope.propertyId);
  if (!owner) return undefined;
  const topic =
    entry.kind === "topic"
      ? entry
      : (await listGuideEntriesForProperty(deps.db, context, owner.property.id)).find(
          (candidate): candidate is Extract<GuideEntryRecord, { kind: "topic" }> =>
            candidate.kind === "topic" &&
            candidate.key === entry.key &&
            candidate.scope.level === "property",
        );
  return { entry, topic, ...owner };
}

// ── Translation state (prepared for later AI translation) ──────────────────────────

function localizedTexts(content: GuideContent, meta?: Partial<GuideTopic>): LocalizedText[] {
  const fromBlock = (block: GuideBlock): LocalizedText[] => {
    switch (block.type) {
      case "heading":
      case "paragraph":
        return [block.text];
      case "list":
        return [...block.items];
      case "callout":
        return block.title ? [block.title, block.text] : [block.text];
      case "image":
        return block.caption ? [block.image.alt, block.caption] : [block.image.alt];
      case "link":
      case "action":
        return [block.label];
    }
  };
  return [
    ...(meta?.title ? [meta.title] : []),
    ...(meta?.shortDescription ? [meta.shortDescription] : []),
    ...(meta?.eyebrow ? [meta.eyebrow] : []),
    ...(content.intro ? [content.intro] : []),
    ...(content.heroImage ? [content.heroImage.alt] : []),
    ...content.blocks.flatMap(fromBlock),
  ];
}

/** German is the source; English is "reviewed" once every text has an English version. */
export function translationStateOf(
  content: GuideContent,
  meta?: Partial<GuideTopic>,
): TranslationState {
  const texts = localizedTexts(content, meta);
  return { en: texts.every((value) => Boolean(value["en"])) ? "reviewed" : "missing" };
}

// ── Validation helpers ─────────────────────────────────────────────────────────────

function contentSchemaFor(deps: GuideAdminDeps, target: { tenantId: string; propertyId: string }) {
  return guideContentSchema((src) => deps.isAllowedImageSrc(src, target));
}

function parseJson(raw: string): unknown {
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return undefined;
  }
}

async function liveTopics(deps: GuideAdminDeps, context: TenantContext, propertyId: string) {
  return (await listGuideEntriesForProperty(deps.db, context, propertyId)).filter(
    (entry): entry is Extract<GuideEntryRecord, { kind: "topic" }> => entry.kind === "topic",
  );
}

function uniqueValue(base: string, taken: ReadonlySet<string>): string {
  if (!taken.has(base)) return base;
  for (let suffix = 2; ; suffix++) {
    const candidate = `${base.slice(0, 60)}-${suffix}`;
    if (!taken.has(candidate)) return candidate;
  }
}

function slugConflict(
  topics: readonly GuideTopic[],
  slug: LocalizedText,
  exceptId?: string,
): string | undefined {
  for (const locale of ["de", "en"] as const) {
    const value = slug[locale];
    if (!value) continue;
    const clash = topics.find(
      (topic) => topic.id !== exceptId && (topic.slug.de === value || topic.slug.en === value),
    );
    if (clash) return `Der Adressname „${value}“ ist in diesem Objekt bereits vergeben.`;
  }
  return undefined;
}

// ── Operations ─────────────────────────────────────────────────────────────────────

export type NewTopicInput = {
  titleDe: string;
  titleEn: string;
  shortDescriptionDe: string;
  shortDescriptionEn: string;
  icon: string;
  scope: "property" | "unit";
  unitId?: string;
};

export async function createTopic(
  deps: GuideAdminDeps,
  context: TenantContext,
  propertyId: string,
  input: NewTopicInput,
): Promise<Result<{ id: string }>> {
  const owner = await propertyOf(deps, context, propertyId);
  if (!owner) return fail("Objekt nicht gefunden.");
  if (input.scope === "unit" && !owner.units.some((unit) => unit.id === input.unitId)) {
    return fail("Bitte ein Apartment dieses Objekts auswählen.");
  }
  const topics = await liveTopics(deps, context, propertyId);
  const slugDe = slugify(input.titleDe) || "thema";
  const slugEn = input.titleEn ? slugify(input.titleEn) || undefined : undefined;
  const taken = new Set(
    topics.flatMap((topic) => [topic.slug.de, topic.slug.en].filter(Boolean) as string[]),
  );
  const meta = guideTopicMetaSchema.safeParse({
    title: { de: input.titleDe, ...(input.titleEn ? { en: input.titleEn } : {}) },
    shortDescription: {
      de: input.shortDescriptionDe,
      ...(input.shortDescriptionEn ? { en: input.shortDescriptionEn } : {}),
    },
    eyebrow: {},
    slug: {
      de: uniqueValue(slugDe, taken),
      ...(slugEn ? { en: uniqueValue(slugEn, new Set([...taken, slugDe])) } : {}),
    },
    icon: input.icon,
  });
  if (!meta.success)
    return fail("Bitte Titel und Kurzbeschreibung (Deutsch) ausfüllen und ein Symbol wählen.");

  const keyBase = slugDe.slice(0, 56);
  const key = uniqueValue(
    isEntityKey(keyBase) ? keyBase : "thema",
    new Set(topics.map((topic) => topic.key)),
  );
  const content: GuideContent = { blocks: [] };
  const created = await createGuideTopic(deps.db, context, {
    key,
    scope:
      input.scope === "unit" && input.unitId
        ? { level: "unit", propertyId, unitId: input.unitId }
        : { level: "property", propertyId },
    sortOrder: (topics.reduce((max, topic) => Math.max(max, topic.sortOrder), 0) || 0) + 10,
    icon: meta.data.icon,
    slug: meta.data.slug,
    title: meta.data.title,
    shortDescription: meta.data.shortDescription,
    blocks: [],
    translationState: translationStateOf(content, meta.data),
  });
  deps.logger.info("guide topic created", { entryId: created.id, propertyId });
  return { ok: true, id: created.id };
}

export type TopicMetaInput = {
  titleDe: string;
  titleEn: string;
  shortDescriptionDe: string;
  shortDescriptionEn: string;
  eyebrowDe: string;
  eyebrowEn: string;
  slugDe: string;
  slugEn: string;
  icon: string;
};

export async function updateTopic(
  deps: GuideAdminDeps,
  context: TenantContext,
  entryId: string,
  input: TopicMetaInput,
): Promise<Result> {
  const loaded = await loadGuideEntry(deps, context, entryId);
  if (!loaded || loaded.entry.kind !== "topic") return fail("Thema nicht gefunden.");
  const meta = guideTopicMetaSchema.safeParse({
    title: { de: input.titleDe, ...(input.titleEn ? { en: input.titleEn } : {}) },
    shortDescription: {
      de: input.shortDescriptionDe,
      ...(input.shortDescriptionEn ? { en: input.shortDescriptionEn } : {}),
    },
    eyebrow: { de: input.eyebrowDe, en: input.eyebrowEn },
    slug: { de: input.slugDe.trim(), ...(input.slugEn.trim() ? { en: input.slugEn.trim() } : {}) },
    icon: input.icon as GuideIcon,
  });
  if (!meta.success) {
    return fail(
      "Bitte Titel, Kurzbeschreibung und Adressname (Kleinbuchstaben, Ziffern, Bindestriche) prüfen.",
    );
  }
  const conflict = slugConflict(
    await liveTopics(deps, context, loaded.property.id),
    meta.data.slug,
    entryId,
  );
  if (conflict) return fail(conflict);
  await updateGuideTopicMeta(deps.db, context, entryId, {
    title: meta.data.title,
    shortDescription: meta.data.shortDescription,
    slug: meta.data.slug,
    icon: meta.data.icon,
    ...(meta.data.eyebrow ? { eyebrow: meta.data.eyebrow } : {}),
  });
  await updateGuideContent(deps.db, context, entryId, {
    ...loaded.entry,
    translationState: translationStateOf(loaded.entry, meta.data),
  });
  return { ok: true };
}

/** Saves intro, hero image and blocks (JSON from the editor). Published → live at once. */
export async function updateContent(
  deps: GuideAdminDeps,
  context: TenantContext,
  entryId: string,
  rawJson: string,
): Promise<Result> {
  const loaded = await loadGuideEntry(deps, context, entryId);
  if (!loaded) return fail("Inhalt nicht gefunden.");
  const parsed = contentSchemaFor(deps, {
    tenantId: context.tenantId,
    propertyId: loaded.property.id,
  }).safeParse(parseJson(rawJson));
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return fail(
      `Der Inhalt ist unvollständig: ${issue ? issue.path.join(" › ") || "Eingabe" : "Eingabe"} – bitte prüfe die deutschen Pflichtfelder.`,
    );
  }
  const content: GuideContent = {
    blocks: parsed.data.blocks,
    ...(parsed.data.intro ? { intro: parsed.data.intro } : {}),
    ...(parsed.data.heroImage ? { heroImage: parsed.data.heroImage } : {}),
  };
  const target = { tenantId: context.tenantId, propertyId: loaded.property.id };
  const stored = new Set(imageSources(loaded.entry));
  for (const src of new Set(imageSources(content))) {
    if (stored.has(src)) continue;
    let verified = false;
    try {
      verified = await deps.verifyNewImage(src, target);
    } catch {
      deps.logger.error("guide image verification failed", { propertyId: target.propertyId });
    }
    if (!verified) return fail("Ein Bild ist ungültig oder fehlt. Bitte lade es erneut hoch.");
  }
  const ok = await updateGuideContent(deps.db, context, entryId, {
    ...content,
    translationState: translationStateOf(
      content,
      loaded.entry.kind === "topic" ? loaded.entry : undefined,
    ),
  });
  return ok ? { ok: true } : fail("Inhalt nicht gefunden.");
}

/** Adds apartment-specific content for a property-wide topic (starts as a copy). */
export async function createOverride(
  deps: GuideAdminDeps,
  context: TenantContext,
  topicId: string,
  unitId: string,
): Promise<Result<{ id: string }>> {
  const loaded = await loadGuideEntry(deps, context, topicId);
  if (!loaded || loaded.entry.kind !== "topic") return fail("Thema nicht gefunden.");
  if (loaded.entry.scope.level !== "property") {
    return fail("Varianten gibt es nur für Themen, die für das gesamte Objekt gelten.");
  }
  if (!loaded.units.some((unit) => unit.id === unitId))
    return fail("Bitte ein Apartment dieses Objekts auswählen.");
  const existing = (await listGuideEntriesForProperty(deps.db, context, loaded.property.id)).some(
    (entry) =>
      entry.kind === "override" && entry.key === loaded.entry.key && entry.scope.unitId === unitId,
  );
  if (existing) return fail("Für dieses Apartment gibt es bereits eine Variante.");
  const content: GuideContent = {
    blocks: loaded.entry.blocks,
    ...(loaded.entry.intro ? { intro: loaded.entry.intro } : {}),
    ...(loaded.entry.heroImage ? { heroImage: loaded.entry.heroImage } : {}),
  };
  const created = await createGuideOverride(deps.db, context, {
    key: loaded.entry.key,
    scope: { level: "unit", propertyId: loaded.property.id, unitId },
    ...content,
    translationState: translationStateOf(content),
  });
  deps.logger.info("guide override created", { entryId: created.id, topicId });
  return { ok: true, id: created.id };
}

/** Draft / published / archived. Archiving a topic also archives its overrides. */
export async function changeStatus(
  deps: GuideAdminDeps,
  context: TenantContext,
  entryId: string,
  status: GuideStatus,
): Promise<Result> {
  const loaded = await loadGuideEntry(deps, context, entryId);
  if (!loaded) return fail("Inhalt nicht gefunden.");
  const now = deps.now();
  await setGuideEntryStatus(deps.db, context, entryId, status, now);
  if (loaded.entry.kind === "topic" && status === "archived") {
    const overrides = (
      await listGuideEntriesForProperty(deps.db, context, loaded.property.id)
    ).filter((entry) => entry.kind === "override" && entry.key === loaded.entry.key);
    for (const override of overrides)
      await setGuideEntryStatus(deps.db, context, override.id, "archived", now);
  }
  deps.logger.info("guide status changed", { entryId, status });
  return { ok: true };
}

export async function moveTopic(
  deps: GuideAdminDeps,
  context: TenantContext,
  entryId: string,
  direction: "up" | "down",
): Promise<Result> {
  const loaded = await loadGuideEntry(deps, context, entryId);
  if (!loaded || loaded.entry.kind !== "topic") return fail("Thema nicht gefunden.");
  const ids = (await liveTopics(deps, context, loaded.property.id)).map((topic) => topic.id);
  const index = ids.indexOf(entryId);
  const target = direction === "up" ? index - 1 : index + 1;
  if (index < 0 || target < 0 || target >= ids.length) return { ok: true };
  [ids[index], ids[target]] = [ids[target] ?? entryId, ids[index] ?? entryId];
  await setGuideTopicOrder(deps.db, context, ids);
  return { ok: true };
}

/** Never-published entries can be deleted; everything else is archived instead. */
export async function deleteEntry(
  deps: GuideAdminDeps,
  context: TenantContext,
  entryId: string,
): Promise<Result<{ propertyId: string; topicId?: string }>> {
  const loaded = await loadGuideEntry(deps, context, entryId);
  if (!loaded) return fail("Inhalt nicht gefunden.");
  if (loaded.entry.firstPublishedAt) {
    return fail("Bereits veröffentlichte Inhalte werden archiviert, nicht gelöscht.");
  }
  if (loaded.entry.kind === "topic") {
    const hasOverrides = (
      await listGuideEntriesForProperty(deps.db, context, loaded.property.id, {
        includeArchived: true,
      })
    ).some((entry) => entry.kind === "override" && entry.key === loaded.entry.key);
    if (hasOverrides)
      return fail("Bitte zuerst die Apartment-Varianten löschen oder das Thema archivieren.");
  }
  const deleted = await deleteUnpublishedGuideEntry(deps.db, context, entryId);
  if (!deleted) return fail("Der Inhalt konnte nicht gelöscht werden.");
  return {
    ok: true,
    propertyId: loaded.property.id,
    ...(loaded.entry.kind === "override" && loaded.topic ? { topicId: loaded.topic.id } : {}),
  };
}
