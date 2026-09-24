// Public menu for the restaurant detail page (SSR — a Server Component, no
// client JS): groups with their descriptions, each item's name, description
// and price (or sizes), and a small photo only when the API returned one
// (it never does while the `menu_item_photos_enabled` platform flag is off).
// Free-tier content, shown to everyone including signed-out visitors.
//
// Layout (375px first): each item is a row of [optional 64px photo] +
// [name/description] with the single price aligned right on wider screens
// and wrapping under the name on phones; a sized item lists its sizes as
// "Personal $10 · Double $15 · Family Pack $25" chips that wrap freely.
// Items without a group render FIRST, under no heading, then each group.
// Renders nothing when there is nothing to show — no empty heading.
import { MenuBookIcon } from "@/components/ui/icons";
import { isMenuEmpty } from "@/lib/menu/format";
import type { MenuItem, MenuResponse } from "@/types/menu";

function ItemRow({ item }: { item: MenuItem }) {
  const sizes = item.sizes && item.sizes.length > 0 ? item.sizes : null;
  return (
    <li className="flex gap-3 py-3">
      {item.photo_thumbnail_url && (
        // eslint-disable-next-line @next/next/no-img-element -- remote CloudFront URL, no next/image domain config for this host
        <img
          src={item.photo_thumbnail_url}
          alt={`Photo of ${item.name}`}
          loading="lazy"
          className="h-16 w-16 shrink-0 rounded-brand-control border border-brand-border object-cover"
        />
      )}
      <div className="min-w-0 flex-1">
        <div className="flex flex-col gap-0.5 sm:flex-row sm:items-baseline sm:justify-between sm:gap-4">
          <h4 className="min-w-0 break-words text-base font-semibold text-brand-ink">{item.name}</h4>
          {!sizes && item.price && (
            <p className="break-words text-sm font-semibold text-brand-ink sm:max-w-[40%] sm:shrink-0 sm:text-right">
              {item.price}
            </p>
          )}
        </div>
        {item.description && (
          <p className="mt-0.5 whitespace-pre-line break-words text-sm leading-relaxed text-brand-ink-muted">
            {item.description}
          </p>
        )}
        {sizes && (
          <ul
            aria-label={`Sizes and prices for ${item.name}`}
            className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-brand-ink"
          >
            {sizes.map((size, index) => (
              <li key={`${size.label}-${index}`} className="flex items-center gap-2">
                {index > 0 && (
                  <span aria-hidden="true" className="text-brand-ink-subtle">
                    ·
                  </span>
                )}
                <span>
                  {size.label} <span className="font-semibold">{size.price}</span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </li>
  );
}

function ItemList({ items }: { items: MenuItem[] }) {
  return (
    <ul className="divide-y divide-brand-border border-y border-brand-border">
      {items.map((item) => (
        <ItemRow key={item.id} item={item} />
      ))}
    </ul>
  );
}

export default function RestaurantMenu({ menu }: { menu: MenuResponse | null | undefined }) {
  if (!menu || isMenuEmpty(menu)) return null;
  const sections = menu.sections.filter((section) => section.items.length > 0);

  return (
    <section
      id="menu"
      aria-labelledby="menu-heading"
      className="rounded-brand-card border border-brand-border bg-white p-5 shadow-brand-card sm:p-6"
    >
      <h2
        id="menu-heading"
        className="flex items-center gap-2 font-display text-xl font-bold text-brand-ink"
      >
        <MenuBookIcon className="h-5 w-5 text-brand-ink-subtle" />
        Menu
      </h2>

      <div className="mt-3 flex flex-col gap-6">
        {menu.ungrouped_items.length > 0 && <ItemList items={menu.ungrouped_items} />}
        {sections.map((section) => (
          <div key={section.id}>
            <h3 className="break-words font-display text-lg font-bold text-brand-ink">
              {section.name}
            </h3>
            {section.description && (
              <p className="mt-0.5 mb-1 whitespace-pre-line break-words text-sm text-brand-ink-muted">
                {section.description}
              </p>
            )}
            <ItemList items={section.items} />
          </div>
        ))}
      </div>
    </section>
  );
}
