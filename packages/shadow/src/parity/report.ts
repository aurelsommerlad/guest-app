/**
 * Markdown rendering of the parity run. Explanations of known deviations live in
 * docs/staging/extras-migration-m3-paritaet.md (cause and correct solution per deviation);
 * this file only lists what the run found.
 */
type Report = {
  createdAt: string;
  extrasSource: string;
  apaleo: string;
  gatewayMode: string;
  scenarios: {
    id: string;
    title: string;
    identical: boolean;
    deviations: { step: string; field: string; extras: unknown; stay: unknown }[];
    importWarnings: string[];
  }[];
};

const cell = (value: unknown) =>
  `\`${JSON.stringify(value).replace(/\|/g, "\\|").slice(0, 160)}\``;

export function renderMarkdown(report: Report): string {
  const lines = [
    "# Paritätslauf Extras ↔ STAY (automatisch erzeugt)",
    "",
    `Erzeugt: ${report.createdAt} · Extras: ${report.extrasSource} · Apaleo: ${report.apaleo} · Gateway: ${report.gatewayMode}`,
    "",
    "Bewertung und Lösung jeder Abweichung: `extras-migration-m3-paritaet.md`.",
    "",
    "| Szenario | Ergebnis |",
    "| --- | --- |",
    ...report.scenarios.map(
      (s) =>
        `| ${s.id} ${s.title} | ${s.identical ? "identisch" : `${String(s.deviations.length)} Abweichung(en)`} |`,
    ),
    "",
  ];
  for (const s of report.scenarios) {
    if (s.identical && !s.importWarnings.length) continue;
    lines.push(`## ${s.id} ${s.title}`, "");
    if (s.importWarnings.length) lines.push(`Importhinweise: ${s.importWarnings.map((w) => `\`${w}\``).join(", ")}`, "");
    if (s.deviations.length) {
      lines.push("| Schritt | Feld | Extras | STAY |", "| --- | --- | --- | --- |");
      for (const d of s.deviations) lines.push(`| ${d.step} | ${d.field} | ${cell(d.extras)} | ${cell(d.stay)} |`);
      lines.push("");
    }
  }
  return `${lines.join("\n")}\n`;
}
