export const isPreviewTarget =
  Boolean(process.env["CI"]) || Boolean(process.env["E2E_PREVIEW"]);
