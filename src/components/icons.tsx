// The package's own icon strokes (it ships no icon library): 16-grid,
// 1.5 stroke, round caps — the same voice as the chassis' lucide set.

export function ComposeIcon() {
  return (
    <svg
      viewBox="0 0 16 16"
      aria-hidden="true"
      className="tf:size-4 tf:shrink-0"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M8 2.5H4A1.5 1.5 0 0 0 2.5 4v8A1.5 1.5 0 0 0 4 13.5h8a1.5 1.5 0 0 0 1.5-1.5V8" />
      <path d="M12.3 2.3a1.2 1.2 0 0 1 1.7 1.7L8.5 9.5l-2.3.6.6-2.3z" />
    </svg>
  );
}

export function ArrowUpIcon() {
  return (
    <svg
      viewBox="0 0 16 16"
      aria-hidden="true"
      className="tf:size-4 tf:shrink-0"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M8 12.5v-9M4 7l4-3.5L12 7" />
    </svg>
  );
}

// The stop square: the send arrow's busy-state counterpart — a
// filled rounded square, the universal "stop generating" glyph.
export function StopIcon() {
  return (
    <svg
      viewBox="0 0 16 16"
      aria-hidden="true"
      className="tf:size-4 tf:shrink-0"
      fill="currentColor"
      stroke="none"
    >
      <rect x="4.25" y="4.25" width="7.5" height="7.5" rx="1.5" />
    </svg>
  );
}

// The drawer header's disclosure arrow — it points at the history menu
// it drops open. The drawn twin of the transcript's lucide chevron,
// package-local because the minimized companion's static graph must stay
// transcript-free (importing anything from lucide-react drags its barrel
// into the closure the bundle test guards).
export function ChevronDownIcon() {
  return (
    <svg
      viewBox="0 0 16 16"
      aria-hidden="true"
      className="tf:size-4 tf:shrink-0"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M3.5 6l4.5 4.5L12.5 6" />
    </svg>
  );
}

// The drawer's minimize affordance: a plain dash, never an X — dismissing
// the drawer collapses it back into the perch, and both the conversation
// and the companion survive. An X would promise a destruction that never
// happens.
export function MinimizeIcon() {
  return (
    <svg
      viewBox="0 0 16 16"
      aria-hidden="true"
      className="tf:size-4 tf:shrink-0"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M3.5 8h9" />
    </svg>
  );
}

// The mode switcher's trigger: the drawer's silhouette with the docked
// column it can become. Package-local like every stroke here — the
// minimized companion's static graph must stay icon-library-free.
export function SidebarIcon() {
  return (
    <svg
      viewBox="0 0 16 16"
      aria-hidden="true"
      className="tf:size-4 tf:shrink-0"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="2.5" y="2.5" width="11" height="11" rx="1.5" />
      <path d="M9.5 2.5v11" />
    </svg>
  );
}

// The active row's mark in the mode menu.
export function CheckIcon() {
  return (
    <svg
      viewBox="0 0 16 16"
      aria-hidden="true"
      className="tf:size-4 tf:shrink-0"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M3 8.5l3.2 3L13 4.5" />
    </svg>
  );
}

export function CloseIcon() {
  return (
    <svg
      viewBox="0 0 16 16"
      aria-hidden="true"
      className="tf:size-4 tf:shrink-0"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M4 4l8 8M12 4l-8 8" />
    </svg>
  );
}

// The prompt rows' trailing affordance: present but transparent until the
// row is hovered, so the column's right edge doesn't twitch on approach.
export function ArrowRightIcon() {
  return (
    <svg
      viewBox="0 0 16 16"
      aria-hidden="true"
      className="tf:size-4 tf:shrink-0"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M3.5 8h9M9 4.5L12.5 8 9 11.5" />
    </svg>
  );
}

// The opening prompts' capability glyphs. Four classes, because four is
// what the concierge actually does: look something up, judge the state of
// the docs, write one, explain the product. The host picks the class; the
// stroke belongs to the package.

export function SearchIcon() {
  return (
    <svg
      viewBox="0 0 16 16"
      aria-hidden="true"
      className="tf:size-4 tf:shrink-0"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="7.2" cy="7.2" r="4.2" />
      <path d="M10.4 10.4L13.5 13.5" />
    </svg>
  );
}

export function FlagIcon() {
  return (
    <svg
      viewBox="0 0 16 16"
      aria-hidden="true"
      className="tf:size-4 tf:shrink-0"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M3.5 14V2.5h6l-.7 2.3 3.7 0v5H6.3l.5-2.3H3.5" />
    </svg>
  );
}

export function BookIcon() {
  return (
    <svg
      viewBox="0 0 16 16"
      aria-hidden="true"
      className="tf:size-4 tf:shrink-0"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M2.5 3.2A1.2 1.2 0 0 1 3.7 2H8v11.5H3.7a1.2 1.2 0 0 0-1.2 1.2z" />
      <path d="M13.5 3.2A1.2 1.2 0 0 0 12.3 2H8v11.5h4.3a1.2 1.2 0 0 1 1.2 1.2z" />
    </svg>
  );
}

export function FileIcon() {
  return (
    <svg
      viewBox="0 0 16 16"
      aria-hidden="true"
      className="tf:size-4 tf:shrink-0"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M9 1.8H4.5A1.5 1.5 0 0 0 3 3.3v9.4a1.5 1.5 0 0 0 1.5 1.5h7a1.5 1.5 0 0 0 1.5-1.5V5.8z" />
      <path d="M9 1.8v4h4" />
    </svg>
  );
}

export function PlusIcon() {
  return (
    <svg
      viewBox="0 0 16 16"
      aria-hidden="true"
      className="tf:size-4 tf:shrink-0"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M8 3.2v9.6M3.2 8h9.6" />
    </svg>
  );
}

// The OpenAI blossom, monochrome (the provider chip's mark): a filled
// brand glyph, not one of the package's 16-grid strokes — it identifies
// the visitor's own service, in ink like everything else (Graphite's
// No-Accent law covers marks too).
export function OpenAiMarkIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      className="tf:size-3.5 tf:shrink-0"
      fill="currentColor"
    >
      <path d="M22.2819 9.8211a5.9847 5.9847 0 0 0-.5157-4.9108 6.0462 6.0462 0 0 0-6.5098-2.9A6.0651 6.0651 0 0 0 4.9807 4.1818a5.9847 5.9847 0 0 0-3.9977 2.9 6.0462 6.0462 0 0 0 .7427 7.0966 5.98 5.98 0 0 0 .511 4.9107 6.051 6.051 0 0 0 6.5146 2.9001A5.9847 5.9847 0 0 0 13.2599 24a6.0557 6.0557 0 0 0 5.7718-4.2058 5.9894 5.9894 0 0 0 3.9977-2.9001 6.0557 6.0557 0 0 0-.7475-7.0729zm-9.022 12.6081a4.4755 4.4755 0 0 1-2.8764-1.0408l.1419-.0804 4.7783-2.7582a.7948.7948 0 0 0 .3927-.6813v-6.7369l2.02 1.1686a.071.071 0 0 1 .038.052v5.5826a4.504 4.504 0 0 1-4.4945 4.4944zm-9.6607-4.1254a4.4708 4.4708 0 0 1-.5346-3.0137l.142.0852 4.783 2.7582a.7712.7712 0 0 0 .7806 0l5.8428-3.3685v2.3324a.0804.0804 0 0 1-.0332.0615L9.74 19.9502a4.4992 4.4992 0 0 1-6.1408-1.6464zM2.3408 7.8956a4.485 4.485 0 0 1 2.3655-1.9728V11.6a.7664.7664 0 0 0 .3879.6765l5.8144 3.3543-2.0201 1.1685a.0757.0757 0 0 1-.071 0l-4.8303-2.7865A4.504 4.504 0 0 1 2.3408 7.872zm16.5963 3.8558L13.1038 8.364 15.1192 7.2a.0757.0757 0 0 1 .071 0l4.8303 2.7913a4.4944 4.4944 0 0 1-.6765 8.1042v-5.6772a.79.79 0 0 0-.407-.667zm2.0107-3.0231l-.142-.0852-4.7735-2.7818a.7759.7759 0 0 0-.7854 0L9.409 9.2297V6.8974a.0662.0662 0 0 1 .0284-.0615l4.8303-2.7866a4.4992 4.4992 0 0 1 6.6802 4.66zM8.3065 12.863l-2.02-1.1638a.0804.0804 0 0 1-.038-.0567V6.0742a4.4992 4.4992 0 0 1 7.3757-3.4537l-.142.0805L8.704 5.459a.7948.7948 0 0 0-.3927.6813zm1.0976-2.3654l2.602-1.4998 2.6069 1.4998v2.9994l-2.5974 1.4997-2.6067-1.4997Z" />
    </svg>
  );
}
