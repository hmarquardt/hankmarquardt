import type { CSSProperties } from "react";
export type IconName =
  | "record"
  | "library"
  | "download"
  | "search"
  | "plus"
  | "play"
  | "pause"
  | "next"
  | "previous"
  | "back"
  | "check"
  | "close"
  | "queue"
  | "logout"
  | "wifi"
  | "shuffle"
  | "trash"
  | "volume"
  | "playlist"
  | "edit"
  | "up"
  | "down";
const paths: Record<IconName, React.ReactNode> = {
  record: (
    <>
      <circle cx="12" cy="12" r="9" />
      <circle cx="12" cy="12" r="3" />
      <path d="M7 7a7 7 0 0 1 5-2M17 17a7 7 0 0 1-5 2" />
    </>
  ),
  library: (
    <>
      <rect x="3" y="4" width="5" height="16" rx="1" />
      <path d="M12 4v16M16 5l5 14" />
    </>
  ),
  download: (
    <>
      <path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5" />
    </>
  ),
  search: (
    <>
      <circle cx="10.5" cy="10.5" r="6.5" />
      <path d="m16 16 5 5" />
    </>
  ),
  plus: <path d="M12 4v16M4 12h16" />,
  play: <path d="m8 4 12 8-12 8Z" fill="currentColor" stroke="none" />,
  pause: (
    <>
      <path d="M7 5v14M17 5v14" strokeWidth="4" />
    </>
  ),
  next: (
    <>
      <path d="m4 5 11 7-11 7Z" fill="currentColor" stroke="none" />
      <path d="M19 5v14" />
    </>
  ),
  previous: (
    <>
      <path d="m20 5-11 7 11 7Z" fill="currentColor" stroke="none" />
      <path d="M5 5v14" />
    </>
  ),
  back: <path d="m14 5-7 7 7 7M7 12h14" />,
  check: <path d="m5 12 5 5L20 7" />,
  close: <path d="m6 6 12 12M6 18 18 6" />,
  queue: (
    <>
      <path d="M3 5h18M3 11h12M3 17h8m6-3 5 3-5 3Z" />
    </>
  ),
  logout: (
    <>
      <path d="M10 4H4v16h6m4-13 5 5-5 5m-5-5h12" />
    </>
  ),
  wifi: (
    <>
      <path d="M3 8a15 15 0 0 1 18 0M6 12a10 10 0 0 1 12 0M9 16a5 5 0 0 1 6 0" />
      <circle cx="12" cy="20" r=".5" />
    </>
  ),
  shuffle: (
    <>
      <path d="M3 6h3l12 12h3m-4-4 4 4-4 4M3 18h3l4-4m4-4 4-4h3m-4-4 4 4-4 4" />
    </>
  ),
  trash: (
    <>
      <path d="M3 6h18M9 6V3h6v3M6 6l1 15h10l1-15M10 10v7m4-7v7" />
    </>
  ),
  volume: (
    <>
      <path d="M3 9h4l5-5v16l-5-5H3Zm13-2a7 7 0 0 1 0 10" />
    </>
  ),
  playlist: (
    <>
      <path d="M3 6h12M3 12h12M3 18h8" />
      <circle cx="17" cy="18" r="2.5" />
      <path d="M19.5 18V7l-3 1" />
    </>
  ),
  edit: <path d="m4 20 4-1L19 8l-3-3L5 16l-1 4ZM14 7l3 3" />,
  up: <path d="m6 15 6-6 6 6" />,
  down: <path d="m6 9 6 6 6-6" />,
};
export function Icon({
  name,
  size = 22,
  style,
}: {
  name: IconName;
  size?: number;
  style?: CSSProperties;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      style={style}
    >
      {paths[name]}
    </svg>
  );
}
