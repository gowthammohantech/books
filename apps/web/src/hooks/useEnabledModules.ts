import { useSelector } from "react-redux";

import type { RootState } from "@store/index";
import { parseEnabledModules, type SetupModuleKey } from "@lib/setupModules";

/**
 * The modules this workspace chose during setup, or `null` for "never chose".
 *
 * `null` is the answer for every workspace that predates the setup wizard, and
 * it means SHOW EVERYTHING - not "show nothing". The distinction is why the
 * selection is stored as a GeneralSetting row rather than a `text[]` column:
 * an absent row says "unset" honestly, whereas a text[] defaults to `{}` and
 * makes "never asked" and "switched everything off" the same value.
 *
 * One hook rather than a selector at each call site, so the payload shape is
 * named in exactly one place if it ever moves.
 */
export const useEnabledModules = (): SetupModuleKey[] | null => {
    const raw = useSelector((state: RootState) => state.systemSettings.data?.enabledModules);
    return parseEnabledModules(raw);
};
