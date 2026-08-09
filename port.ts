const DEFAULT_PORT = 5173;

export const readPort = (raw: string | undefined): number => {
  if (raw === undefined || raw === "") {
    return DEFAULT_PORT;
  }

  const parsed = /^\d+$/.test(raw) ? Number(raw) : Number.NaN;
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
    throw new Error(
      `PLAYWRIGHT_PORT must be an integer from 1 to 65535, got ${JSON.stringify(raw)}`,
    );
  }

  return parsed;
};

export const localServerPort = readPort(process.env["PLAYWRIGHT_PORT"]);
export const localServerURL = `http://localhost:${String(localServerPort)}`;
