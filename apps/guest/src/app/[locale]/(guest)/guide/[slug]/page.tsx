import { Container, Heading, Text } from "@up/ui";
import type { Metadata } from "next";
import Image from "next/image";
import { hasLocale } from "next-intl";
import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";

import { BackHeader } from "../../../../../components/GuestHeader";
import { GuideBlocks } from "../../../../../features/guide/components/GuideBlocks";
import { getGuideArticle } from "../../../../../features/guide/get-guide";
import { requireGuestContext } from "../../../../../features/guest-context/server";
import { routing } from "../../../../../i18n/routing";

type Props = { params: Promise<{ locale: string; slug: string }> };

async function loadArticle(params: Props["params"]) {
  const { locale, slug } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  // Sections depend on the guest's property/unit, so pages render per request;
  // unknown slugs (or a slug of another locale) are 404s.
  const context = await requireGuestContext(locale);
  const article = await getGuideArticle(context, locale, slug);
  if (!article) notFound();
  return article;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const article = await loadArticle(params);
  return { title: article.title };
}

/** GUIDE detail page – an editorial article built from content blocks. */
export default async function GuideArticlePage({ params }: Props) {
  const article = await loadArticle(params);
  const t = await getTranslations("guide");

  return (
    <div className="safe-top">
      <Container width="content" className="md:max-w-reading lg:max-w-content lg:pt-10">
        <BackHeader href="/guide" label={t("backLabel")} />

        <main className="lg:max-w-reading">
          <article>
            <header className="mt-6 flex flex-col gap-3 lg:mt-16">
              {article.eyebrow && (
                <Text variant="eyebrow" tone="muted">
                  {article.eyebrow}
                </Text>
              )}
              <Heading level={1}>{article.title}</Heading>
              {article.intro && (
                <Text variant="lead" tone="muted" className="max-w-80 text-balance">
                  {article.intro}
                </Text>
              )}
            </header>

            {article.heroImage && (
              <Image
                src={article.heroImage.src}
                width={article.heroImage.width}
                height={article.heroImage.height}
                alt={article.heroImage.alt}
                sizes="(min-width: 768px) 640px, 100vw"
                preload
                placeholder={article.heroImage.blurDataUrl ? "blur" : "empty"}
                blurDataURL={article.heroImage.blurDataUrl}
                className="mt-6 aspect-hero w-full rounded-card object-cover lg:mt-8"
              />
            )}

            <div className="mt-8">
              {article.blocks.length > 0 ? (
                <GuideBlocks blocks={article.blocks} />
              ) : (
                <Text tone="muted">{t("comingSoon")}</Text>
              )}
            </div>
          </article>
        </main>
      </Container>
    </div>
  );
}
