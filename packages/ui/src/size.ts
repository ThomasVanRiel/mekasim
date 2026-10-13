/** Keep a size within what a panel can usefully be. */
export function clamp(size: number, min: number, max: number): number {
  return Math.round(Math.min(Math.max(size, min), Math.max(min, max)));
}
