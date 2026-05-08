import assert from "node:assert/strict";
import { parseEncoreMetadataOutput } from "../templates/default/scripts/lib/encore-resources.mjs";

const parsed = parseEncoreMetadataOutput(`\x1b[31mNotes not valid JSON\x1b[0m
{
  "svcs": [],
  "sql_databases": [],
  "message": "brace } inside string"
}
`);

assert.deepEqual(parsed.svcs, []);
assert.equal(parsed.message, "brace } inside string");
