import { createElement, Fragment, type ReactNode, useRef } from "react";
import type { Block, Inline } from "../help/markdown.ts";
import { HELP, sectionsOf } from "../help/reference.ts";
import { useLayout } from "../layout.ts";

/** The panel's id, for the button that folds it open. */
export const HELP_ID = "format-help";

const SECTIONS = sectionsOf(HELP);

/** The reference never changes while it is shown, so its parts need no keys to be told apart. */
function each<T>(items: T[], render: (item: T) => ReactNode): ReactNode {
  return createElement(Fragment, null, ...items.map(render));
}

function Text({ content }: { content: Inline[] }) {
  return each(content, (part) => {
    if (part.kind === "text") return part.text;
    if (part.kind === "code") {
      return <code className="rounded-sm bg-paper px-1 font-mono text-[0.88em]">{part.text}</code>;
    }
    if (part.kind === "strong") {
      return (
        <strong className="font-semibold">
          <Text content={part.content} />
        </strong>
      );
    }
    // A link to a file beside the reference leads nowhere from the app; show its words only.
    if (!/^https?:/.test(part.href)) return <Text content={part.content} />;
    return (
      <a href={part.href} target="_blank" rel="noreferrer" className="text-dye underline">
        <Text content={part.content} />
      </a>
    );
  });
}

function Part({ block }: { block: Block }) {
  if (block.kind === "heading") {
    return block.level <= 2 ? (
      <h3
        id={`${HELP_ID}-${block.id}`}
        className="mt-8 mb-2 border-rule border-b pb-1 font-semibold text-lg first:mt-0"
      >
        <Text content={block.content} />
      </h3>
    ) : (
      <h4 id={`${HELP_ID}-${block.id}`} className="mt-5 mb-1.5 font-semibold">
        <Text content={block.content} />
      </h4>
    );
  }
  if (block.kind === "paragraph") {
    return (
      <p className="my-2">
        <Text content={block.content} />
      </p>
    );
  }
  if (block.kind === "list") {
    return (
      <ul className="my-2 list-disc space-y-1 pl-5">
        {each(block.items, (item) => (
          <li>
            <Text content={item} />
          </li>
        ))}
      </ul>
    );
  }
  if (block.kind === "code") {
    return (
      <pre className="my-2 overflow-x-auto border border-rule bg-paper px-3 py-2 font-mono text-[13px] leading-normal">
        {block.text}
      </pre>
    );
  }
  return (
    <div className="my-3 overflow-x-auto">
      <table className="w-full border-collapse text-left text-sm">
        <thead>
          <tr>
            {each(block.head, (cell) => (
              <th className="border-ink-soft border-b px-2 py-1 font-semibold first:pl-0">
                <Text content={cell} />
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {each(block.rows, (row) => (
            <tr>
              {each(row, (cell) => (
                <td className="border-rule border-b px-2 py-1 align-top first:pl-0">
                  <Text content={cell} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * The format reference, folded open beside the source: it lies over the drawing and
 * the panels to the right of it, which stay as they are underneath, so the source
 * can be written with the reference next to it.
 *
 * It is always there and is uncovered from the source's edge rightwards when it
 * opens, and covered again when it closes. Hidden, it takes no clicks and no focus.
 */
export function Help() {
  const open = useLayout((s) => s.help);
  const setHelp = useLayout((s) => s.setHelp);
  const page = useRef<HTMLDivElement>(null);

  return (
    <section
      id={HELP_ID}
      aria-label="Help on the model format"
      // Placed on the grid of the page by position, so that it takes no cell from the panels under it.
      className={`absolute inset-0 z-40 hidden flex-col bg-sheet/95 transition-[clip-path,visibility] duration-500 ease-out motion-reduce:transition-none lg:col-start-3 lg:col-end-6 lg:row-start-2 lg:row-end-3 lg:flex ${open ? "visible [clip-path:inset(0)]" : "invisible [clip-path:inset(0_100%_0_0)]"
        }`}
    >
      <div className="flex items-center justify-between border-rule border-b py-1 pr-2 pl-3">
        <h2 className="font-semibold">Writing a model</h2>
        <button
          type="button"
          onClick={() => setHelp(false)}
          className="rounded-sm border border-rule bg-sheet px-2 py-0.5 text-sm hover:border-ink-soft active:bg-paper"
        >
          Close
        </button>
      </div>
      <div className="flex min-h-0 flex-1">
        <nav aria-label="Sections of the help" className="w-52 shrink-0 overflow-y-auto py-2">
          <ul>
            {SECTIONS.map((section) => (
              <li key={section.id}>
                <button
                  type="button"
                  onClick={() =>
                    page.current
                      ?.querySelector(`#${HELP_ID}-${section.id}`)
                      ?.scrollIntoView({ block: "start" })
                  }
                  className="w-full px-3 py-1 text-left text-sm hover:bg-paper"
                >
                  {section.title}
                </button>
              </li>
            ))}
          </ul>
        </nav>
        <div ref={page} className="min-w-0 flex-1 overflow-y-auto border-rule border-l px-6 py-4">
          <div className="max-w-3xl">
            {each(HELP, (block) => (
              <Part block={block} />
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
