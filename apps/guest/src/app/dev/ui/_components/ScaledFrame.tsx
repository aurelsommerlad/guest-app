"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Renders a page in an iframe at a real viewport width and scales it down to
 * fit. Media queries inside the frame respond to the real width.
 */
export function ScaledFrame({
  src,
  width,
  height,
  title,
}: {
  src: string;
  width: number;
  height: number;
  title: string;
}) {
  const wrapper = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);

  useEffect(() => {
    const element = wrapper.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setScale(Math.min(1, entry.contentRect.width / width));
    });
    observer.observe(element);
    return () => {
      observer.disconnect();
    };
  }, [width]);

  return (
    <div ref={wrapper} className="w-full" style={{ maxWidth: width }}>
      <div
        className="relative overflow-hidden rounded-card border border-border bg-background"
        style={{ height: height * scale }}
      >
        <iframe
          src={src}
          title={title}
          width={width}
          height={height}
          loading="lazy"
          // Absolutely positioned so the unscaled frame width never widens the layout.
          className="absolute top-0 left-0 origin-top-left border-0"
          style={{ transform: `scale(${scale})` }}
        />
      </div>
    </div>
  );
}
