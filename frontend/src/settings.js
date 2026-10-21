// Settings page: import a JSON export bundle.

import { api, toast } from "./common.js";

const input = document.getElementById("import-file");
const result = document.getElementById("import-result");

input?.addEventListener("change", async () => {
  const file = input.files?.[0];
  if (!file) return;
  result.textContent = `Importing ${file.name}…`;
  try {
    const text = await file.text();
    const { imported } = await api("POST", "/api/import", text, { raw: true });
    result.textContent = `Imported ${imported} diagram${imported === 1 ? "" : "s"}.`;
    toast("Import complete");
  } catch (err) {
    result.textContent = `Import failed: ${err.message}`;
    toast("Import failed", "error");
  } finally {
    input.value = "";
  }
});
