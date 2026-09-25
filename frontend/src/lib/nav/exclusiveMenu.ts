// "Only one top-bar menu open at a time": the hamburger panel (TopBarNav.tsx),
// the account dropdown (AccountMenu.tsx) and the admin bell
// (AdminNotificationsBell.tsx) are separate client components with their own
// open state, so opening one used to leave another open underneath (the account
// dropdown then covered the hamburger's links on a phone). Each menu announces
// itself here when it opens and closes itself when another one does. Escape /
// focus-return / outside-click handling stays inside each component.
//
// A module-level EventTarget (not `window`), so it is trivially unit-testable
// in node and never touches the DOM.

const bus = new EventTarget();
const EVENT = "top-bar-menu-open";

class MenuOpenEvent extends Event {
  readonly menuId: string;
  constructor(menuId: string) {
    super(EVENT);
    this.menuId = menuId;
  }
}

/** Tell every other menu that `menuId` just opened. */
export function announceMenuOpen(menuId: string): void {
  bus.dispatchEvent(new MenuOpenEvent(menuId));
}

/**
 * Runs `onOtherOpened` whenever a menu other than `menuId` opens. Returns the
 * unsubscribe function (use it as a React effect cleanup).
 */
export function onOtherMenuOpen(menuId: string, onOtherOpened: () => void): () => void {
  const listener = (event: Event) => {
    if (event instanceof MenuOpenEvent && event.menuId !== menuId) onOtherOpened();
  };
  bus.addEventListener(EVENT, listener);
  return () => bus.removeEventListener(EVENT, listener);
}
