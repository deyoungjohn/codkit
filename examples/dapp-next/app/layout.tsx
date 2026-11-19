import type { ReactNode } from "react";
import { Providers } from "./providers";

export const metadata = { title: "codkit dapp (Next.js)" };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body style={{ margin: 0, fontFamily: "system-ui, sans-serif", background: "var(--ck-bg)", color: "var(--ck-fg)" }}>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
