import { formatQuantity, LENGTH, type MeasuredGap, type Units } from "@mekasim/core";
import type { ContactResult } from "@mekasim/fit";

/** The closest clearance of a contact pair, in ordinary words for its row. */
export function contactText(distance: number, units: Units): string {
  if (distance === 0) return "Touching";
  const size = formatQuantity(Math.abs(distance), LENGTH, units, 4);
  return distance < 0 ? `${size} into each other` : `${size} apart`;
}

/** The requested gaps plus the hovered contact, without drawing the same pair twice. */
export function gapsWithContact(gaps: MeasuredGap[], contact?: ContactResult): MeasuredGap[] {
  if (!contact) return gaps;
  const { a, b } = contact;
  return [
    ...gaps.filter((gap) => !((gap.a === a && gap.b === b) || (gap.a === b && gap.b === a))),
    contact.measured,
  ];
}
