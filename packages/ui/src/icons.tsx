import type { ReactNode } from "react";

/** The few line icons the components use: 24px grid, 1.5 stroke, `currentColor`, decorative (the buttons carry the label). */
const Svg = ({ children, size = 16 }: { children: ReactNode; size?: number }) => (
  <svg
    className="ck-svg"
    viewBox="0 0 24 24"
    width={size}
    height={size}
    fill="none"
    stroke="currentColor"
    strokeWidth={1.5}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
    focusable="false"
  >
    {children}
  </svg>
);

export const XIcon = () => (
  <Svg>
    <path d="M6 6l12 12M18 6 6 18" />
  </Svg>
);
export const ArrowUpRightIcon = () => (
  <Svg>
    <path d="M7 17 17 7M8.5 7H17v8.5" />
  </Svg>
);
export const CopyIcon = () => (
  <Svg>
    <rect x="9" y="9" width="11" height="11" rx="2.5" />
    <path d="M15 9V6.5A2.5 2.5 0 0 0 12.5 4h-6A2.5 2.5 0 0 0 4 6.5v6A2.5 2.5 0 0 0 6.5 15H9" />
  </Svg>
);
export const CheckIcon = () => (
  <Svg>
    <path d="m5 12.5 4.5 4.5L19 7.5" />
  </Svg>
);
export const AlertIcon = () => (
  <Svg>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7.5v5.5M12 16.2v.1" />
  </Svg>
);
/** An open arc: it turns while a transaction waits (the one animation that says "still working"). */
export const SpinnerIcon = () => (
  <Svg>
    <path className="ck-spin" d="M21 12a9 9 0 1 1-9-9" />
  </Svg>
);
