/** Pensée's mark: the Thick–Thin ¶, small cut (see docs/brand.md). */
export function PenseeMark({ size = 24 }: { size?: number }) {
  return (
    <svg
      width={(size * 87) / 80}
      height={size}
      viewBox="-30 10 87 80"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      fill="currentColor"
    >
      <path d="M-28 12H35V68A20 20 0 0 0 55 88H29V17H21V88H0V40A28 28 0 0 0 -28 12Z" />
    </svg>
  );
}
