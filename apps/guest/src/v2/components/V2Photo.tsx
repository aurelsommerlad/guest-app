import Image, { type StaticImageData } from "next/image";

import { Link } from "../../i18n/navigation";
import { V2Arrow } from "./glyphs";

/**
 * Editorial photo surface: square corners, a soft gradient at the bottom only, eyebrow and
 * a light title bottom left, a thin arrow bottom right. The whole photo is one link.
 */
export function V2Photo({
  href,
  eyebrow,
  title,
  image,
  variant,
  priority = false,
  external = false,
}: {
  href: string;
  eyebrow: string;
  title: string;
  image: { src: StaticImageData | string; focus?: string };
  variant: "feature" | "half";
  priority?: boolean;
  external?: boolean;
}) {
  const content = (
    <>
      <span className="v2-photo-media">
        <Image
          src={image.src}
          alt=""
          fill
          sizes={
            variant === "feature"
              ? "(min-width: 600px) 560px, 100vw"
              : "(min-width: 600px) 280px, 50vw"
          }
          preload={priority}
          style={{ objectFit: "cover", ...(image.focus ? { objectPosition: image.focus } : {}) }}
        />
      </span>
      <span className="v2-photo-text">
        <span>
          <span className="v2-eyebrow block">{eyebrow}</span>
          <span className="v2-photo-title block">{title}</span>
        </span>
        <V2Arrow />
      </span>
    </>
  );
  const className = `v2-photo v2-photo--${variant}`;
  return external ? (
    <a href={href} className={className}>
      {content}
    </a>
  ) : (
    <Link href={href} className={className}>
      {content}
    </Link>
  );
}
