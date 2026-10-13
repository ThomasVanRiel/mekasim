/**
 * Names as shown in the interface. In the model text a name is one word, such as
 * `upper_deck` or `link1`; on screen it reads as ordinary words: "Upper deck",
 * "Link 1". The text keeps its own spelling everywhere it is quoted or edited.
 */

/** A name from the model as words, with a capital first letter. */
export function label(id: string): string {
  const words = id
    .split("_")
    .filter((word) => word !== "")
    // A number straight after a word is a counter: link1, dist12. A letter and a
    // number, such as G1, is a name of its own and stays together.
    .map((word) => word.replace(/^([A-Za-z]{2,})(\d+)$/, "$1 $2"));
  const text = words.join(" ");
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** A point written as `body.point` in the model: the body as words, then the point as named. */
export function refLabel(ref: string): string {
  const [body, point] = ref.split(".");
  return point === undefined ? label(ref) : `${label(body as string)} ${point}`;
}

/** A kind and a name, such as "Link 1" or "Crank Eccentric", without saying the kind twice. */
export function titled(kind: string, id: string): string {
  const name = label(id);
  return name.toLowerCase().startsWith(kind.toLowerCase()) ? name : `${kind} ${name}`;
}
