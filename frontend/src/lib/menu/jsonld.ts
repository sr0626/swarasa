// schema.org `hasMenu` markup for the public restaurant page, plus the safe
// JSON-LD serializer the page uses for ALL its structured data.
//
// Prices are deliberately NOT emitted: a menu price is free text ("$12",
// "12 / 18", "Market price", "Personal $10 · Double $15") and schema.org's
// `Offer.price` needs a clean number + currency, so any attempt to fill it
// from free text would produce wrong markup. Name + description only —
// correct and still useful to crawlers. Kept free of `@/` alias imports so
// `npm run test:unit` can import it directly.

interface JsonLdItem {
  name: string;
  description: string | null;
}

interface JsonLdMenuInput {
  ungrouped_items: readonly JsonLdItem[];
  sections: readonly { name: string; description: string | null; items: readonly JsonLdItem[] }[];
}

interface MenuItemNode {
  "@type": "MenuItem";
  name: string;
  description?: string;
}

interface MenuSectionNode {
  "@type": "MenuSection";
  name: string;
  description?: string;
  hasMenuItem: MenuItemNode[];
}

export interface MenuNode {
  "@type": "Menu";
  hasMenuItem?: MenuItemNode[];
  hasMenuSection?: MenuSectionNode[];
}

function itemNode(item: JsonLdItem): MenuItemNode {
  return {
    "@type": "MenuItem",
    name: item.name,
    ...(item.description ? { description: item.description } : {}),
  };
}

/** `hasMenu` value for the Restaurant node, or `undefined` when the menu has
 * nothing to publish (so the key is simply omitted). Ungrouped items hang
 * directly off the Menu; empty groups are skipped. */
export function buildMenuSchema(menu: JsonLdMenuInput | null | undefined): MenuNode | undefined {
  if (!menu) return undefined;
  const sections: MenuSectionNode[] = menu.sections
    .filter((section) => section.items.length > 0)
    .map((section) => ({
      "@type": "MenuSection" as const,
      name: section.name,
      ...(section.description ? { description: section.description } : {}),
      hasMenuItem: section.items.map(itemNode),
    }));
  if (menu.ungrouped_items.length === 0 && sections.length === 0) return undefined;
  return {
    "@type": "Menu",
    ...(menu.ungrouped_items.length > 0
      ? { hasMenuItem: menu.ungrouped_items.map(itemNode) }
      : {}),
    ...(sections.length > 0 ? { hasMenuSection: sections } : {}),
  };
}

/**
 * JSON.stringify for embedding inside `<script type="application/ld+json">`
 * via dangerouslySetInnerHTML. Owner-authored free text (dish names,
 * descriptions) ends up in this payload, so a literal `</script>` inside a
 * value would otherwise close the tag early and inject markup. Escaping `<`
 * (and the two JS line-separator code points) as \u escapes keeps the JSON
 * identical when parsed but can never terminate the script element.
 */
export function jsonLdString(value: unknown): string {
  // Built from char codes (not literals) so this source file never contains
  // a raw U+2028/U+2029 line terminator.
  const lineSeparator = String.fromCharCode(0x2028);
  const paragraphSeparator = String.fromCharCode(0x2029);
  return JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .split(lineSeparator)
    .join("\\u2028")
    .split(paragraphSeparator)
    .join("\\u2029");
}
