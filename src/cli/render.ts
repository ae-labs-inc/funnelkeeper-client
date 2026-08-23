// Output shaping: calm voice, padded columns, right-aligned numerals.
// ANSI dim/bold only when stdout is a TTY; no color dependency.
const tty = process.stdout.isTTY === true;
export const dim = (s: string) => (tty ? `\x1b[2m${s}\x1b[0m` : s);
export const bold = (s: string) => (tty ? `\x1b[1m${s}\x1b[0m` : s);

export function table(headers: string[], rows: string[][], rightAlign: number[] = []): string {
  const all = [headers, ...rows];
  const widths = headers.map((_, i) => Math.max(...all.map((r) => (r[i] ?? "").length)));
  const fmt = (r: string[], header = false) =>
    r.map((cell, i) => {
      const pad = widths[i] - (cell ?? "").length;
      const text = rightAlign.includes(i) ? " ".repeat(pad) + (cell ?? "") : (cell ?? "") + " ".repeat(pad);
      return header ? dim(text) : text;
    }).join("  ");
  return [fmt(headers, true), ...rows.map((r) => fmt(r))].join("\n");
}

export function money(cents: number | string | null, currency = "USD"): string {
  if (cents === null || cents === undefined) return "—";
  const n = Number(cents);
  if (!Number.isFinite(n)) return "—";
  const abs = Math.abs(n) / 100;
  const sym = currency === "EUR" ? "€" : currency === "GBP" ? "£" : "$";
  const sign = n < 0 ? "-" : "";
  if (abs >= 10_000) return `${sign}${sym}${(abs / 1000).toFixed(1).replace(/\.0$/, "")}k`;
  return `${sign}${sym}${abs.toLocaleString("en-US", { maximumFractionDigits: abs < 100 ? 2 : 0 })}`;
}

export function fail(message: string): never {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}
