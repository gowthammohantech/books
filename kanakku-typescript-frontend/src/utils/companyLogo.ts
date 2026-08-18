import logoFallback from "@assets/images/logo.png";
import { assetUrl } from "@utils/assetUrl";

/**
 * Returns a usable logo src: the company's uploaded siteLogo when set, else the
 * bundled fallback. Treats "" (the fresh-install default) as unset, so the
 * branding never renders a blank/broken <img>.
 */
export function resolveCompanyLogo(siteLogo?: string | null): string {
  const v = (siteLogo ?? "").trim();
  return v ? assetUrl(v) : logoFallback;
}

export default resolveCompanyLogo;
