// Pure helpers for the hide/show controls in the owner editor (menu items,
// menu groups, the whole menu, and deals). Kept free of `@/` alias imports so
// `npm run test:unit` (node --test with type stripping) can import it.
//
// Hiding is always non-destructive: a hidden thing stays in the editor,
// clearly marked, with a one-click Show; only the public read drops it.

interface ItemLike {
  id: number;
  is_hidden: boolean;
}

interface SectionLike<I extends ItemLike> {
  id: number;
  is_hidden: boolean;
  items: I[];
}

interface MenuLike<I extends ItemLike, S extends SectionLike<I>> {
  menu_hidden: boolean;
  ungrouped_items: I[];
  sections: S[];
}

/** Optimistic update: a copy of the menu with one item's flag set. */
export function withItemHidden<I extends ItemLike, S extends SectionLike<I>, M extends MenuLike<I, S>>(
  menu: M,
  itemId: number,
  hidden: boolean
): M {
  const patch = (item: I): I => (item.id === itemId ? { ...item, is_hidden: hidden } : item);
  return {
    ...menu,
    ungrouped_items: menu.ungrouped_items.map(patch),
    sections: menu.sections.map((section) => ({ ...section, items: section.items.map(patch) })),
  };
}

/** Optimistic update: a copy of the menu with one group's flag set (its
 * items keep their own flags — showing the group again restores them). */
export function withSectionHidden<
  I extends ItemLike,
  S extends SectionLike<I>,
  M extends MenuLike<I, S>,
>(menu: M, sectionId: number, hidden: boolean): M {
  return {
    ...menu,
    sections: menu.sections.map((section) =>
      section.id === sectionId ? { ...section, is_hidden: hidden } : section
    ),
  };
}

/** How many items (and groups) the OWNER has individually hidden — shown as a
 * summary so hidden things are never forgotten. Items inside a hidden group
 * are not double-counted as individually hidden unless they carry their own
 * flag. */
export function countHidden<I extends ItemLike, S extends SectionLike<I>>(menu: MenuLike<I, S>): {
  items: number;
  sections: number;
} {
  let items = menu.ungrouped_items.filter((i) => i.is_hidden).length;
  let sections = 0;
  for (const section of menu.sections) {
    if (section.is_hidden) sections += 1;
    items += section.items.filter((i) => i.is_hidden).length;
  }
  return { items, sections };
}

/** "2 hidden items and 1 hidden group" style summary, or "" when nothing is
 * individually hidden. */
export function hiddenSummary(counts: { items: number; sections: number }): string {
  const parts: string[] = [];
  if (counts.items > 0) parts.push(`${counts.items} hidden item${counts.items === 1 ? "" : "s"}`);
  if (counts.sections > 0) {
    parts.push(`${counts.sections} hidden group${counts.sections === 1 ? "" : "s"}`);
  }
  return parts.join(" and ");
}
