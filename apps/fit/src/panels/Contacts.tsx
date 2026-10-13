import { label } from "@mekasim/ui";
import { contactText } from "../contacts.ts";
import { useStore } from "../store.ts";

/** Listed contact pairs and the closest they came over the run. */
export function Contacts() {
  const contacts = useStore((state) => state.shown?.contacts ?? []);
  const units = useStore((state) => state.shown?.compiled?.units);
  const show = useStore((state) => state.showContact);

  return (
    <section aria-label="Contacts" className="border-rule border-b">
      <details open>
        <summary className="cursor-pointer border-rule border-b px-3 py-2 font-semibold">
          Contacts
        </summary>
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
