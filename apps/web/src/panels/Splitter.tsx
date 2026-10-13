import { Splitter as Divider } from "@mekasim/ui";
import type { ComponentProps } from "react";
import { type Sizes, useLayout } from "../layout.ts";

/** A divider that resizes one of the panels, whose size is remembered with the layout. */
export function Splitter({
  panel,
  ...rest
}: { panel: keyof Sizes } & Omit<ComponentProps<typeof Divider>, "size" | "onResize">) {
  const size = useLayout((s) => s[panel]);
  const resize = useLayout((s) => s.resize);
  return <Divider {...rest} size={size} onResize={(next) => resize(panel, next)} />;
}
