export function resolveProdPlatform(input = process.env.PROD_PLATFORM || "__PROD_PLATFORM__") {
  const value = String(input || "linux/amd64").trim().toLowerCase();
  const aliases = {
    amd64: "linux/amd64",
    x64: "linux/amd64",
    x86_64: "linux/amd64",
    arm: "linux/arm64",
    arm64: "linux/arm64",
    aarch64: "linux/arm64",
  };
  const platform = aliases[value] || value;
  const match = platform.match(/^(linux)\/(amd64|arm64)$/);

  if (!match) {
    throw new Error(`Invalid PROD_PLATFORM=${JSON.stringify(input)}. Use linux/amd64 or linux/arm64.`);
  }

  return {
    platform,
    os: match[1],
    arch: match[2],
  };
}
