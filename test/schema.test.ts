import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { Ajv2020 } from "ajv/dist/2020.js";
import { analyzeFile } from "../src/analyze.js";
import {
  buildMultiSessionReport,
  buildSummaryReport,
} from "../src/report.js";

const fixtures = join(process.cwd(), "test", "fixtures");
const schemaFile = join(process.cwd(), "schemas", "report.schema.json");

async function validator() {
  const schema = JSON.parse(await readFile(schemaFile, "utf8")) as object;
  const ajv = new Ajv2020({
    allErrors: true,
    strict: true,
    formats: {
      "date-time": /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/,
    },
  });
  return ajv.compile(schema);
}

function jsonValue<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

test("generated single-, multi-, and summary reports satisfy the JSON schema", async () => {
  const validate = await validator();
  const simple = jsonValue(await analyzeFile(join(fixtures, "simple.jsonl")));
  const complex = jsonValue(await analyzeFile(join(fixtures, "complex.jsonl")));
  const multi = jsonValue(buildMultiSessionReport([simple, complex]));
  const singleSummary = jsonValue(buildSummaryReport([simple]));
  const multiSummary = jsonValue(buildSummaryReport([simple, complex]));

  for (const report of [simple, complex, multi, singleSummary, multiSummary]) {
    assert.equal(
      validate(report),
      true,
      JSON.stringify(validate.errors, null, 2),
    );
  }
});

test("the JSON schema rejects missing, extra, and malformed nested fields", async () => {
  const validate = await validator();
  const valid = jsonValue(await analyzeFile(join(fixtures, "simple.jsonl")));

  const missingAccounting = { ...valid } as Record<string, unknown>;
  delete missingAccounting.accounting;
  assert.equal(validate(missingAccounting), false);

  const extraRootField = { ...valid, raw_prompt: "must never be public" };
  assert.equal(validate(extraRootField), false);

  const malformedStep = structuredClone(valid);
  malformedStep.turns[0]!.model_steps[0]!.visible_tokens = -1;
  assert.equal(validate(malformedStep), false);

  const summary = jsonValue(buildSummaryReport([valid]));
  assert.equal(validate({ ...summary, sessions: [] }), false);

  const malformedSummary = structuredClone(summary);
  (malformedSummary.findings.by_confidence as Record<string, unknown>).high =
    "many";
  assert.equal(validate(malformedSummary), false);
});
