import { createTheme } from "@mui/material/styles";
import { themeColor } from "./designTokens";

/**
 * MUI theme.
 *
 * The app previously had no MUI theme at all, so anything MUI rendered that
 * was not covered by an inline `sx` fell back to MUI's stock palette — most
 * visibly the default blue `#1976d2` in the radio group, the date-picker
 * calendar popup and the Autocomplete listbox. Those surfaces were off-brand
 * before the token migration and would have stayed off-brand after it, since
 * MUI never sees a Tailwind class.
 *
 * Defining the palette centrally also lets the three `sx` blocks that hardcoded
 * `#7539FF` drop their literals and inherit instead.
 */
export const muiTheme = createTheme({
  palette: {
    primary: {
      main: themeColor("primary"),
      contrastText: themeColor("primary-foreground"),
    },
    error: { main: themeColor("destructive") },
    success: { main: themeColor("success") },
    warning: { main: themeColor("warning") },
    info: { main: themeColor("info") },
    text: {
      primary: themeColor("foreground"),
      secondary: themeColor("muted-foreground"),
    },
    background: {
      default: themeColor("background"),
      paper: themeColor("card"),
    },
    divider: themeColor("border"),
  },

  shape: {
    // Matches --radius (8px), the ERPNext control radius. The old value of 6
    // claimed to match --radius-md, which is calc(--radius - 2px) — it did,
    // but --radius-md is the popover radius, not the control one.
    borderRadius: 8,
  },

  typography: {
    fontFamily: "var(--font-sans)",
  },

  components: {
    // Inputs sit inside the app's own FormField labels, so they should read as
    // the same control: token border, brand focus ring, no MUI-blue.
    MuiOutlinedInput: {
      styleOverrides: {
        // Filled and borderless, matching fieldControlClasses(). MUI always
        // renders the notched outline, so it is made transparent rather than
        // removed — deleting it would break the label notch geometry.
        root: {
          backgroundColor: themeColor("control-bg"),
          borderRadius: 8,
          "& .MuiOutlinedInput-notchedOutline": {
            borderColor: "transparent",
          },
          "&:hover .MuiOutlinedInput-notchedOutline": {
            borderColor: "transparent",
          },
          "&.Mui-focused": {
            boxShadow: `0 0 0 2px ${themeColor("focus-neutral")}`,
          },
          "&.Mui-focused .MuiOutlinedInput-notchedOutline": {
            borderColor: "transparent",
            borderWidth: 1,
          },
          "&.Mui-disabled": {
            backgroundColor: themeColor("control-bg-on-gray"),
          },
        },
        input: {
          color: themeColor("foreground"),
        },
      },
    },

    MuiPaper: {
      styleOverrides: {
        root: {
          backgroundColor: themeColor("card"),
          color: themeColor("foreground"),
        },
      },
    },

    MuiPaginationItem: {
      styleOverrides: {
        root: {
          color: themeColor("primary"),
          "&.Mui-selected": {
            backgroundColor: themeColor("primary"),
            color: themeColor("primary-foreground"),
            "&:hover": { backgroundColor: themeColor("primary") },
          },
          "&:hover": { backgroundColor: themeColor("accent") },
        },
      },
    },

    MuiAutocomplete: {
      styleOverrides: {
        option: {
          '&[aria-selected="true"]': { backgroundColor: themeColor("accent") },
          "&.Mui-focused": { backgroundColor: themeColor("muted") },
        },
      },
    },
  },
});

export default muiTheme;
