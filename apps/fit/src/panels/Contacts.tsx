import { docFactor, LENGTH, unitLabel } from "@mekasim/core";
import { findContacts, pairKey } from "@mekasim/fit";
import { label } from "@mekasim/ui";
import { useEffect, useMemo, useState } from "react";
import { contactText } from "../contacts.ts";
import { useStore } from "../store.ts";

const button = "rounded-sm border border-rule bg-sheet px-2 py-0.5 text-sm hover:border-ink-soft";

function Finder({ onClose }: { onClose(): void }) {
  const shown = useStore((state) => state.shown);
  const add = useStore((state) => state.addContactPairs);
  const [distance, setDistance] = useState("1");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const units = shown?.compiled?.units;
  const number = Number(distance);
  const candidates = useMemo(
    () =>
      shown && units && Number.isFinite(number) && number >= 0
        ? findContacts(shown, number * docFactor(LENGTH, units))
        : [],
    [shown, units, number],
  );

  useEffect(() => {
    setSelected(
      new Set(candidates.filter(({ listed }) => listed).map(({ a, b }) => pairKey(a, b))),
    );
  }, [candidates]);

  const newCount = candidates.filter(
    ({ a, b, listed }) => !listed && selected.has(pairKey(a, b)),
  ).length;

  return (
    <div className="border-rule border-b bg-paper px-3 py-3">
      <div className="flex items-center gap-2">
        <label className="flex items-baseline gap-1 text-sm">
          Find pairs that come within
          <input
            type="number"
            min={0}
            step="any"
            className="w-20 rounded-sm border border-rule bg-sheet px-1.5 py-0.5 tabular-nums"
            value={distance}
            onChange={(event) => setDistance(event.target.value)}
          />
          {units ? unitLabel(LENGTH, units) : ""}
        </label>
        <button type="button" className={button} onClick={onClose}>
          Cancel
        </button>
      </div>
      {candidates.length === 0 ? (
        <p className="mt-2 text-ink-soft text-sm">No pairs come this close.</p>
      ) : (
        <ul className="mt-2 max-h-64 overflow-y-auto border border-rule bg-sheet">
          {candidates.map((candidate) => {
            const key = pairKey(candidate.a, candidate.b);
            return (
              <li key={key} className="border-rule border-b last:border-b-0">
                <label className="flex items-center gap-2 px-2 py-1.5 text-sm">
                  <input
                    type="checkbox"
                    checked={selected.has(key)}
                    disabled={candidate.listed}
                    onChange={(event) => {
                      const next = new Set(selected);
                      if (event.target.checked) next.add(key);
                      else next.delete(key);
                      setSelected(next);
                    }}
                  />
                  <span className="min-w-0 flex-1 truncate">
                    {label(candidate.a)} and {label(candidate.b)}
                  </span>
                  <span className="shrink-0 text-ink-soft tabular-nums">
                    {candidate.listed
                      ? "Already listed"
                      : contactText(
                          candidate.smallest.distance,
                          units as NonNullable<typeof units>,
                        )}
                  </span>
                </label>
              </li>
            );
          })}
        </ul>
      )}
      <button
        type="button"
        className={`${button} mt-2`}
        disabled={newCount === 0}
        onClick={() => {
          add(
            candidates
              .filter(({ a, b, listed }) => !listed && selected.has(pairKey(a, b)))
              .map(({ a, b }) => [a, b]),
          );
          onClose();
        }}
      >
        {newCount === 0
          ? "Choose pairs to add"
          : `Add ${newCount} pair${newCount === 1 ? "" : "s"}`}
      </button>
    </div>
  );
}

/** Listed contact pairs and the closest they came over the run. */
export function Contacts() {
  const contacts = useStore((state) => state.shown?.contacts ?? []);
  const units = useStore((state) => state.shown?.compiled?.units);
  const show = useStore((state) => state.showContact);
  const [finding, setFinding] = useState(false);

  return (
    <section aria-label="Contacts" className="border-rule border-b">
      <details open>
        <summary className="cursor-pointer border-rule border-b px-3 py-2 font-semibold">
          Contacts
        </summary>
        <div className="border-rule border-b px-3 py-2">
          <button type="button" className={button} onClick={() => setFinding(!finding)}>
            {finding ? "Close find contacts" : "Find contacts"}
          </button>
        </div>
        {finding && <Finder onClose={() => setFinding(false)} />}
        {contacts.length === 0 || !units ? (
          <p className="px-3 py-3 text-ink-soft text-sm">No contacts are listed.</p>
        ) : (
          <ul className="py-1">
            {contacts.map((contact) => (
              <li key={`${contact.a}\0${contact.b}`}>
                <button
                  type="button"
                  className="flex w-full items-baseline justify-between gap-3 px-3 py-2 text-left hover:bg-paper focus:bg-paper"
                  onPointerEnter={() => show(contact)}
                  onPointerLeave={() => show()}
                  onFocus={() => show(contact)}
                  onBlur={() => show()}
                >
                  <span className="min-w-0 truncate text-sm">
                    {label(contact.a)} and {label(contact.b)}
                  </span>
                  <span className="shrink-0 text-right text-ink-soft text-sm tabular-nums">
                    {contactText(contact.smallest.distance, units)}, step {contact.step}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </details>
    </section>
  );
}
