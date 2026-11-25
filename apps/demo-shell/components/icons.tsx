/** Line icons on a 24px grid: 1.5 stroke, `currentColor`, shown at 16 or 18px. Decorative: the control next to them carries the label. */
type P = { className?: string };
const S = ({ className, children }: P & { children: React.ReactNode }) => (
  <svg
    viewBox="0 0 24 24"
    className={className}
    fill="none"
    stroke="currentColor"
    strokeWidth={1.5}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden
  >
    {children}
  </svg>
);

export const Icon = {
  ArrowUpRight: (p: P) => (
    <S {...p}>
      <path d="M7 17 17 7M8.5 7H17v8.5" />
    </S>
  ),
  Grid: (p: P) => (
    <S {...p}>
      <rect x="3" y="3" width="7" height="9" rx="1.5" />
      <rect x="14" y="3" width="7" height="5" rx="1.5" />
      <rect x="14" y="12" width="7" height="9" rx="1.5" />
      <rect x="3" y="16" width="7" height="5" rx="1.5" />
    </S>
  ),
  Activity: (p: P) => (
    <S {...p}>
      <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
    </S>
  ),
  Shield: (p: P) => (
    <S {...p}>
      <path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z" />
      <path d="m9 12 2 2 4-4" />
    </S>
  ),
  Coin: (p: P) => (
    <S {...p}>
      <circle cx="12" cy="12" r="9" />
      <path d="M14.8 9.4c-.4-.9-1.5-1.5-2.8-1.5-1.6 0-2.8.8-2.8 2s1.2 1.7 2.8 2.1c1.6.4 2.8.9 2.8 2.1s-1.2 2-2.8 2c-1.3 0-2.4-.6-2.8-1.5M12 6.5v1.4M12 16.1v1.4" />
    </S>
  ),
  Receipt: (p: P) => (
    <S {...p}>
      <path d="M6 3h12v18l-3-2-3 2-3-2-3 2V3Z" />
      <path d="M9 8h6M9 12h6M9 16h3" />
    </S>
  ),
  Book: (p: P) => (
    <S {...p}>
      <path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1 0-5H20" />
    </S>
  ),
  Plug: (p: P) => (
    <S {...p}>
      <path d="M9 3v5M15 3v5M6.5 8h11v3a5.5 5.5 0 0 1-11 0V8ZM12 16.5V21" />
    </S>
  ),
  Layers: (p: P) => (
    <S {...p}>
      <path d="m12 2 10 5-10 5L2 7z" />
      <path d="m2 17 10 5 10-5M2 12l10 5 10-5" />
    </S>
  ),
  Chevron: (p: P) => (
    <S {...p}>
      <path d="m6 9 6 6 6-6" />
    </S>
  ),
  Power: (p: P) => (
    <S {...p}>
      <path d="M12 2v10M18.4 6.6a9 9 0 1 1-12.77.04" />
    </S>
  ),
  Play: (p: P) => (
    <S {...p}>
      <path d="M7 4.5v15L19.5 12 7 4.5Z" />
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
      <circle cx="16" cy="13.5" r="1" />
    </S>
  ),
  Lock: (p: P) => (
    <S {...p}>
      <rect x="5" y="10.5" width="14" height="10" rx="2.5" />
      <path d="M8 10.5V8a4 4 0 0 1 8 0v2.5" />
    </S>
  ),
};
