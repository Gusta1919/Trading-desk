/**
 * Column spans that leave no row lopsided, for cards on a six-track grid (two tracks
 * at md). Cards are split into rows of at most three, as evenly as possible
 * (4 → 2 + 2, 5 → 3 + 2, 7 → 3 + 2 + 2), and each row shares the six tracks equally.
 * On two columns an odd last card takes the full row.
 */
export function balancedSpans(n: number): string[] {
  if (n <= 0) return [];
  const rows = Math.ceil(n / 3);
  const base = Math.floor(n / rows);
  const extra = n % rows;
  // Written out in full so Tailwind sees every class.
  const lg: Record<number, string> = { 1: "lg:col-span-6", 2: "lg:col-span-3", 3: "lg:col-span-2" };
  const out: string[] = [];
  for (let r = 0; r < rows; r++) {
    const size = base + (r < extra ? 1 : 0);
    for (let k = 0; k < size; k++) out.push(lg[size]);
  }
  if (n % 2 === 1) out[n - 1] = `${out[n - 1]} md:col-span-2`;
  return out;
}
