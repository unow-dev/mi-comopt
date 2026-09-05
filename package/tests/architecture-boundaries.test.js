import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const srcRoot = path.join(packageRoot, "src");

function filesUnder(directory) {
  const files = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...filesUnder(absolute));
    else if (entry.isFile() && /\.(?:js|jsx)$/.test(absolute)) files.push(absolute);
  }
  return files;
}

function importedSpecifiers(source) {
  return [...source.matchAll(/\b(?:from|import)\s*["']([^"']+)["']/g)].map((match) => match[1]);
}

function resolveLocalImport(sourceFile, specifier) {
  if (!specifier.startsWith(".")) return null;
  return path.normalize(path.resolve(path.dirname(sourceFile), specifier));
}

test("src/lib contains only the account compatibility shim", () => {
  const entries = fs.readdirSync(path.join(srcRoot, "lib")).sort();
  assert.deepEqual(entries, ["account-block-candidate-workflow.js"]);
  assert.equal(
    fs.readFileSync(path.join(srcRoot, "lib", entries[0]), "utf8"),
    'export * from "../processing/account-block-candidates/account-block-candidate-workflow.js";\n',
  );
});

test("processing does not import outer layers or cross feature modules", () => {
  const processingRoot = path.join(srcRoot, "processing");
  const keywordRoot = path.join(processingRoot, "keyword-candidates");
  const accountRoot = path.join(processingRoot, "account-block-candidates");
  for (const sourceFile of filesUnder(processingRoot)) {
    const source = fs.readFileSync(sourceFile, "utf8");
    for (const specifier of importedSpecifiers(source)) {
      assert.notEqual(specifier, "react");
      assert.notEqual(specifier, "react-dom");
      assert.notEqual(specifier, "node:sqlite");
      const target = resolveLocalImport(sourceFile, specifier);
      if (!target) continue;
      assert.equal(target.startsWith(path.join(srcRoot, "database")), false, `${sourceFile} imports database`);
      assert.equal(target.startsWith(path.join(srcRoot, "ui")), false, `${sourceFile} imports UI`);
      assert.equal(target.startsWith(path.join(packageRoot, "scripts")), false, `${sourceFile} imports scripts`);
      if (sourceFile.startsWith(keywordRoot)) assert.equal(target.startsWith(accountRoot), false, `${sourceFile} imports account processing`);
      if (sourceFile.startsWith(accountRoot)) assert.equal(target.startsWith(keywordRoot), false, `${sourceFile} imports keyword processing`);
    }
  }
  assert.match(fs.readFileSync(path.join(keywordRoot, "candidate-workflow.js"), "utf8"), /\.\.\/shared\/workflow-validation-error\.js/);
  assert.match(fs.readFileSync(path.join(accountRoot, "account-block-candidate-workflow.js"), "utf8"), /\.\.\/shared\/workflow-validation-error\.js/);
});

test("candidate-data.js is the only UI module that imports generated JSON", () => {
  const uiRoot = path.join(srcRoot, "ui");
  const appSource = fs.readFileSync(path.join(uiRoot, "App.jsx"), "utf8");
  for (const sourceFile of filesUnder(uiRoot)) {
    const source = fs.readFileSync(sourceFile, "utf8");
    for (const specifier of importedSpecifiers(source)) {
      const target = resolveLocalImport(sourceFile, specifier);
      if (target?.startsWith(path.join(srcRoot, "data"))) {
        assert.equal(path.basename(sourceFile), "candidate-data.js");
      }
    }
  }
  assert.doesNotMatch(appSource, /from\s+["'][^"']*src\/data\//);
  assert.doesNotMatch(appSource, /\bitem\.(?:candidate_id|introduced_at|direct_nuisance_hits|reactive_hits|normal_hits|precision_excluding_reactive|match_type|direct_nuisance_count|evidence_sample)\b/);
});
