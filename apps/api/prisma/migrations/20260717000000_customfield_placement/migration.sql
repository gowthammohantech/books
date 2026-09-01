-- CustomField.placement: where a field renders — on the document header (existing
-- behavior) or as a per-line column in the item table. Values for lineItem-placed
-- fields live inside each document's items JSON rows (items[n].customFields),
-- NOT in CustomFieldValue, because line rows have no ids to attach values to.
CREATE TYPE "CustomFieldPlacement" AS ENUM ('document', 'lineItem');

ALTER TABLE "CustomField"
  ADD COLUMN "placement" "CustomFieldPlacement" NOT NULL DEFAULT 'document';
