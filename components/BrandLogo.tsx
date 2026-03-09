import Image from "next/image";
import Link from "next/link";

type BrandLogoProps = {
  href?: string;
  showWordmark?: boolean;
  size?: number;
  className?: string;
};

export function BrandLogo({ href, showWordmark = true, size = 40, className = "" }: BrandLogoProps) {
  const content = (
    <span className={`inline-flex items-center gap-3 ${className}`.trim()}>
      <Image src="/creator-pilot-logo.svg" alt="Creator Pilot logo" width={size} height={size} priority unoptimized className="rounded-full" />
      {showWordmark ? (
        <span>
          <span className="block text-base font-semibold leading-none text-[var(--cp-ink)]">Creator Pilot</span>
          <span className="mt-1 block text-[11px] uppercase tracking-[0.22em] text-[var(--cp-muted-dim)]">AI Video Studio</span>
        </span>
      ) : null}
    </span>
  );

  if (!href) {
    return content;
  }

  return (
    <Link href={href} aria-label="Creator Pilot home">
      {content}
    </Link>
  );
}
