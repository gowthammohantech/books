import { useState, type ReactNode } from "react";
import { DownloadIcon } from "lucide-react";
import { toast } from "sonner";
import { Button, type ButtonVariant } from "@components/ui";
import { downloadExport } from "@utils/downloadExport";

interface ExportButtonProps {
  /** Fully-qualified export endpoint URL (a Constants.* entry). */
  url: string;
  /** Suggested download filename, e.g. "journal-entries.csv". */
  filename: string;
  /** Button label (defaults to "Export CSV"). */
  label?: ReactNode;
  variant?: ButtonVariant;
  className?: string;
}

/**
 * Reusable button that fetches an authenticated export (CSV / ZIP) as a blob and
 * triggers a client-side download. Shows a spinner while downloading, disables
 * itself meanwhile, and surfaces a toast on failure.
 */
export default function ExportButton({
  url,
  filename,
  label = "Export CSV",
  variant = "white",
  className,
}: ExportButtonProps) {
  const [downloading, setDownloading] = useState(false);

  const handleClick = async () => {
    setDownloading(true);
    try {
      await downloadExport(url, filename);
    } catch {
      toast.error("Failed to download export. Please try again.");
    } finally {
      setDownloading(false);
    }
  };

  return (
    <Button
      variant={variant}
      onClick={handleClick}
      isLoading={downloading}
      disabled={downloading}
      leftIcon={<DownloadIcon size={14} />}
      className={className}
    >
      {label}
    </Button>
  );
}
