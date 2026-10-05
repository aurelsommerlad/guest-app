import type { ReactNode } from "react";

export default function AuthLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-6 py-16">
      <p className="type-wordmark text-text">
        UNIQUE PLACES <span className="type-caption pl-1 text-text-muted normal-case">Admin</span>
      </p>
      <div className="mt-10">{children}</div>
    </main>
  );
}
