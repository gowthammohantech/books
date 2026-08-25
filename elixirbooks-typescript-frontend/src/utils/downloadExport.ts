import axios from "axios";
import { store } from "@store/index";

/**
 * Downloads an authenticated export (CSV / ZIP) from the backend and triggers a
 * browser "Save As" by creating a temporary object URL.
 *
 * A plain `<a href>` cannot be used because the export endpoints require the JWT
 * in an `Authorization` header, so we fetch the file as a blob (with the Redux
 * token) and synthesize the download client-side.
 *
 * @param path     Fully-qualified URL of the export endpoint (use a Constants.* entry).
 * @param filename Suggested filename for the saved file (e.g. "journal-entries.csv").
 */
export async function downloadExport(path: string, filename: string): Promise<void> {
  const { token } = store.getState().auth;

  const response = await axios.get(path, {
    responseType: "blob",
    headers: { Authorization: `Bearer ${token}` },
  });

  const blobUrl = window.URL.createObjectURL(response.data as Blob);
  const link = document.createElement("a");
  link.href = blobUrl;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.URL.revokeObjectURL(blobUrl);
}
