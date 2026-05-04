#!/usr/bin/env bun
/**
 * validate-schemas.ts
 * Validates all criteria YAML files against their JSON schemas.
 * Exits non-zero if any validation fails — used in CI.
 */

import Ajv from "ajv";
import * as fs from "fs";
import * as path from "path";
import * as yaml from "js-yaml";

const REPO_ROOT = path.resolve(import.meta.dir, "..");

const FILES_TO_VALIDATE = [
  { yaml: "sensitive_apis.yaml",   schema: "schemas/sensitive_apis.schema.json" },
  { yaml: "risky_frameworks.yaml", schema: "schemas/risky_frameworks.schema.json" },
  { yaml: "risk_scoring.yaml",     schema: "schemas/risk_scoring.schema.json" },
];

const ajv = new Ajv({ allErrors: true, strict: false });
let failed = 0;

for (const { yaml: yamlFile, schema: schemaFile } of FILES_TO_VALIDATE) {
  const yamlPath   = path.join(REPO_ROOT, yamlFile);
  const schemaPath = path.join(REPO_ROOT, schemaFile);

  try {
    const data   = yaml.load(fs.readFileSync(yamlPath, "utf8"));
    const schema = JSON.parse(fs.readFileSync(schemaPath, "utf8"));
    const validate = ajv.compile(schema);

    if (!validate(data)) {
      console.error(`✗ ${yamlFile} — validation errors:`);
      for (const err of validate.errors ?? []) {
        console.error(`  ${err.instancePath || "/"} ${err.message}`);
      }
      failed++;
    } else {
      console.log(`✓ ${yamlFile}`);
    }
  } catch (e) {
    console.error(`✗ ${yamlFile} — ${e}`);
    failed++;
  }
}

if (failed > 0) {
  console.error(`\n${failed} file(s) failed validation.`);
  process.exit(1);
} else {
  console.log("\nAll criteria files valid.");
}
