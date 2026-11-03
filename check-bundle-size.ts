import { BUDGETS, checkBundleSize, formatReport } from "./bundle-size.ts";

const reports = checkBundleSize("dist/assets", BUDGETS);

for (const report of reports) {
  console.log(formatReport(report));
}

if (reports.some((report) => !report.ok)) {
  process.exitCode = 1;
}
