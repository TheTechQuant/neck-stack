import { promises as fs } from "node:fs";

export async function loadDotEnv(file = ".env") {
  let source = "";
  try {
    source = await fs.readFile(file, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") return;
    throw error;
  }

  for (const line of source.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) continue;

    const [, key, rawValue] = match;
    if (process.env[key] !== undefined) continue;
    process.env[key] = rawValue.trim().replace(/^(['"])([\s\S]*)\1$/, "$2");
  }
}

export async function upsertDotEnv(values, file = ".env") {
  let source = "";
  try {
    source = await fs.readFile(file, "utf8");
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }

  const lines = source ? source.split(/\r?\n/) : [];
  const seen = new Set();
  const next = lines.map((line) => {
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=/);
    if (!match || !(match[1] in values)) return line;
    seen.add(match[1]);
    return `${match[1]}=${quoteEnv(values[match[1]])}`;
  });

  const additions = Object.entries(values)
    .filter(([key]) => !seen.has(key))
    .map(([key, value]) => `${key}=${quoteEnv(value)}`);
  if (additions.length > 0) {
    if (next.length > 0 && next[next.length - 1] !== "") next.push("");
    next.push(...additions);
  }

  await fs.writeFile(file, `${next.join("\n").replace(/\n+$/g, "")}\n`);
}

function quoteEnv(value) {
  const text = String(value ?? "");
  if (!/[#\s'"\\]/.test(text)) return text;
  return `'${text.replaceAll("'", "'\"'\"'")}'`;
}
