// Icon-key -> component map shared by the console menu renderers.
import {
  BarChartIcon,
  ClipboardCheckIcon,
  ClockIcon,
  FlagIcon,
  MailIcon,
  PlusIcon,
  StoreIcon,
  TagIcon,
  UserIcon,
} from "@/components/ui/icons";
import type { IconProps } from "@/components/ui/icons";
import type { ConsoleNavIcon } from "@/components/console/navItems";

export const NAV_ICONS: Record<ConsoleNavIcon, (props: IconProps) => JSX.Element> = {
  user: UserIcon,
  claims: ClipboardCheckIcon,
  reports: FlagIcon,
  store: StoreIcon,
  plus: PlusIcon,
  clock: ClockIcon,
  chart: BarChartIcon,
  mail: MailIcon,
  tag: TagIcon,
};
