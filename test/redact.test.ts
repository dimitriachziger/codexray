import assert from "node:assert/strict";
import test from "node:test";
import { boundedSnippet, redactHome } from "../src/redact.js";

test("redacts Linux, macOS, and Windows home-directory paths", () => {
  assert.equal(redactHome("/home/alice/private/project.ts"), "~/private/project.ts");
  assert.equal(redactHome("/Users/alice/private/project.ts"), "~/private/project.ts");
  assert.equal(
    redactHome("C:\\Users\\alice\\private\\project.ts"),
    "~\\private\\project.ts",
  );
});

test("bounded snippets redact paths after normalization", () => {
  const snippet = boundedSnippet(
    "output from\n/home/alice/private/project.ts " + "secret ".repeat(40),
  );
  assert.match(snippet, /~\/private\/project\.ts/);
  assert.doesNotMatch(snippet, /\/home\/alice/);
  assert.ok(snippet.length <= 160);
});
