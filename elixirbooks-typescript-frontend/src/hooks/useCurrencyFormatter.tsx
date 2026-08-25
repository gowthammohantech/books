import type { RootState } from "@store/index";
import { useCallback, useMemo } from "react";
import { useSelector } from "react-redux";

export const useCurrencyFormatter = (showDecimals: boolean = false) => {
  const settings = useSelector((s: RootState) => s.systemSettings.data);

  // Resolve the symbol from the configured system/company default currency.
  // Ultimate fallback mirrors useCurrencies' resolveCurrency ("$"), never a
  // hardcoded India-specific symbol, so totals match per-row amounts.
  const symbol = settings?.currency?.symbol ?? "$";
  const locale =
    typeof navigator !== "undefined" ? navigator.language : "en-IN";

  const formatter = useMemo(
    () =>
      new Intl.NumberFormat(locale, {
        minimumFractionDigits: showDecimals ? 2 : 0,
        maximumFractionDigits: showDecimals ? 2 : 0,
      }),
    [locale, showDecimals]
  );

  const format = useCallback(
    (amount: number) => `${symbol}${formatter.format(amount)}`,
    [symbol, formatter]
  );

  return { format, symbol, locale };
};
