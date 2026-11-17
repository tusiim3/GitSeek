// Small line icons for repository stats. They inherit the text colour and
// are hidden from screen readers; each stat also has a visible or aria label.

function Icon({ children, ...props }) {
  return (
    <svg
      className="icon"
      viewBox="0 0 16 16"
      width="16"
      height="16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...props}
    >
      {children}
    </svg>
  )
}

export function StarIcon() {
  return (
    <Icon>
      <path d="M8 1.75l1.9 3.85 4.25.62-3.08 3 .73 4.23L8 11.45 4.2 13.45l.73-4.23-3.08-3 4.25-.62L8 1.75z" />
    </Icon>
  )
}

// A git fork: two branch tips joining into one trunk
export function ForkIcon() {
  return (
    <Icon>
      <circle cx="4.5" cy="3.25" r="1.5" />
      <circle cx="11.5" cy="3.25" r="1.5" />
      <circle cx="8" cy="12.75" r="1.5" />
      <path d="M4.5 4.75v1.5a2 2 0 002 2h3a2 2 0 002-2v-1.5M8 8.25v3" />
    </Icon>
  )
}

export function CodeIcon() {
  return (
    <Icon>
      <path d="M5.5 4.5L2 8l3.5 3.5M10.5 4.5L14 8l-3.5 3.5" />
    </Icon>
  )
}
