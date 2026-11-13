// Maps a benefit's icon key (lib/ui/signupBenefits.ts) to its SVG. Decorative:
// always aria-hidden, the benefit title carries the meaning. Shared by the
// sign-up popup and the /benefits page.
import {
  BellIcon,
  HeartIcon,
  LocationPinIcon,
  MailIcon,
  TagIcon,
  type IconProps,
} from "@/components/ui/icons";
import type { BenefitIconKey } from "@/lib/ui/signupBenefits";

const ICONS: Record<BenefitIconKey, (props: IconProps) => JSX.Element> = {
  bell: BellIcon,
  tag: TagIcon,
  heart: HeartIcon,
  mail: MailIcon,
  pin: LocationPinIcon,
};

export default function BenefitIcon({ name, className }: { name: BenefitIconKey; className?: string }) {
  const Icon = ICONS[name];
  return <Icon aria-hidden="true" className={className} />;
}
