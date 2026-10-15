/** Small stroke icon set (24px grid, currentColor). */
type P = { className?: string };
const S = ({ className, children, fill }: P & { children: React.ReactNode; fill?: boolean }) => (
  <svg
    viewBox="0 0 24 24"
    className={className}
    fill={fill ? "currentColor" : "none"}
    stroke={fill ? "none" : "currentColor"}
    strokeWidth={1.7}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden
  >
    {children}
  </svg>
);

export const Icon = {
  Clock: (p: P) => (
    <S {...p} fill>
      <path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm.9 5v4.6l3.2 1.9-.9 1.5-4.1-2.4V7h1.8Z" />
    </S>
  ),
  ArrowUpRight: (p: P) => (
    <S {...p}>
      <path d="M7 17 17 7M8 7h9v9" />
    </S>
  ),
  Grid: (p: P) => (
    <S {...p} fill>
      <rect x="3" y="3" width="8" height="18" rx="2.5" />
      <rect x="13" y="3" width="8" height="18" rx="2.5" opacity=".45" />
    </S>
  ),
  Sparkle: (p: P) => (
    <S {...p}>
      <path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M6 18l2.5-2.5M15.5 8.5 18 6" />
    </S>
  ),
  Shield: (p: P) => (
    <S {...p}>
      <path d="M12 3 4.5 6v5.5c0 4.6 3.1 8.3 7.5 9.5 4.4-1.2 7.5-4.9 7.5-9.5V6L12 3Z" />
      <path d="m9 12 2 2 4-4" />
    </S>
  ),
  Coin: (p: P) => (
    <S {...p}>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M14.8 9.4c-.4-.9-1.5-1.5-2.8-1.5-1.6 0-2.8.8-2.8 2s1.2 1.7 2.8 2.1c1.6.4 2.8.9 2.8 2.1s-1.2 2-2.8 2c-1.3 0-2.4-.6-2.8-1.5M12 6.5v1.4M12 16.1v1.4" />
    </S>
  ),
  Receipt: (p: P) => (
    <S {...p}>
      <path d="M6 3h12v18l-3-2-3 2-3-2-3 2V3Z" />
      <path d="M9 8h6M9 12h6M9 16h3" />
    </S>
  ),
  Cube: (p: P) => (
    <S {...p}>
      <path d="m12 3 8 4.5v9L12 21l-8-4.5v-9L12 3Z" />
      <path d="m4 7.5 8 4.5 8-4.5M12 12v9" />
    </S>
  ),
  Plug: (p: P) => (
    <S {...p}>
      <path d="M9 3v5M15 3v5M6.5 8h11v3a5.5 5.5 0 0 1-11 0V8ZM12 16.5V21" />
    </S>
  ),
  Stack: (p: P) => (
    <S {...p} fill>
      <ellipse cx="12" cy="6" rx="8" ry="3" />
      <path d="M4 9.5c0 1.7 3.6 3 8 3s8-1.3 8-3V12c0 1.7-3.6 3-8 3s-8-1.3-8-3V9.5Zm0 6c0 1.7 3.6 3 8 3s8-1.3 8-3V18c0 1.7-3.6 3-8 3s-8-1.3-8-3v-2.5Z" />
    </S>
  ),
  Caret: (p: P) => (
    <S {...p} fill>
      <path d="M12 7 20 17H4L12 7Z" />
    </S>
  ),
  Updown: (p: P) => (
    <S {...p}>
      <path d="m8 9 4-4 4 4M8 15l4 4 4-4" />
    </S>
  ),
  Bolt: (p: P) => (
    <S {...p} fill>
      <path d="M13.5 2 4.5 13.5H11L9.5 22l9-11.5H12L13.5 2Z" />
    </S>
  ),
  Play: (p: P) => (
    <S {...p} fill>
      <path d="M7 4.5v15l12.5-7.5L7 4.5Z" />
    </S>
  ),
  Bell: (p: P) => (
    <S {...p}>
      <path d="M6 16V11a6 6 0 1 1 12 0v5l1.5 2h-15L6 16ZM10 20.5a2 2 0 0 0 4 0" />
    </S>
  ),
  Wallet: (p: P) => (
    <S {...p}>
      <path d="M4 7.5A2.5 2.5 0 0 1 6.5 5H18v3M4 7.5V17a2 2 0 0 0 2 2h14V8H6.5A2.5 2.5 0 0 1 4 7.5Z" />
      <circle cx="16" cy="13.5" r="1.2" fill="currentColor" />
    </S>
  ),
  Lock: (p: P) => (
    <S {...p}>
      <rect x="5" y="10.5" width="14" height="10" rx="2.5" />
      <path d="M8 10.5V8a4 4 0 0 1 8 0v2.5M12 14.5v2" />
    </S>
  ),
  Check: (p: P) => (
    <S {...p}>
      <circle cx="12" cy="12" r="8.5" />
      <path d="m8.5 12.2 2.4 2.4 4.6-4.9" />
    </S>
  ),
  Up: (p: P) => (
    <S {...p}>
      <path d="M12 18V6M6.5 11.5 12 6l5.5 5.5" strokeWidth={3} />
    </S>
  ),
  X: (p: P) => (
    <S {...p}>
      <path d="M7 7l10 10M17 7 7 17" strokeWidth={3} />
    </S>
  ),
  Chart: (p: P) => (
    <S {...p}>
      <path d="M4 4v16h16" />
      <path d="m7 15 4-5 3 3 5-6" />
    </S>
  ),
  Plus: (p: P) => (
    <S {...p}>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 8.5v7M8.5 12h7" />
    </S>
  ),
  Refresh: (p: P) => (
    <S {...p}>
      <path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3M19.5 4.5v4h-4" />
    </S>
  ),
  Filter: (p: P) => (
    <S {...p}>
      <path d="M4 7h16M7 12h10M10 17h4" />
    </S>
  ),
};
