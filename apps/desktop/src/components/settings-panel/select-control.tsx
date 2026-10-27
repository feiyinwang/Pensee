interface SelectControlProps {
  value: string;
  options: string[];
  /** What each option shows, when not the option itself. */
  labels?: Record<string, string>;
  onChange: (value: string) => void;
  ariaLabel?: string;
  disabled?: boolean;
  className?: string;
}

/** Shared ordinary select used by enum and installed-font settings. */
export function SelectControl({
  value,
  options,
  labels,
  onChange,
  ariaLabel,
  disabled = false,
  className = "",
}: SelectControlProps) {
  return (
    <select
      value={value}
      disabled={disabled}
      aria-label={ariaLabel}
      onChange={(event) => onChange(event.target.value)}
      className={`h-9 min-w-[140px] appearance-none rounded-lg border border-transparent bg-[var(--surface-input)] bg-[image:var(--select-chevron)] bg-[length:12px_12px] bg-[position:right_10px_center] bg-no-repeat pl-3 pr-8 text-label text-[var(--text-secondary)] font-[inherit] outline-none focus:border-[var(--focus-border)] focus-visible:outline-none disabled:opacity-60 ${className}`}
    >
      {options.map((option) => (
        <option key={option} value={option}>
          {labels?.[option] ?? option}
        </option>
      ))}
    </select>
  );
}
