import Ajv from "ajv";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { RE2JS } from "re2js";
import { badRequest } from "./errors.js";
const linearRegex = Object.assign(
  (pattern: string, flags?: string) => {
    const regex = RE2JS.compile(
      pattern,
      flags?.includes("i") ? RE2JS.CASE_INSENSITIVE : 0,
    );
    return { test: (v: string) => regex.matcher(v).find() };
  },
  { code: "RE2" },
);
const options = {
  allErrors: false,
  strict: true,
  validateFormats: true,
  code: { regExp: linearRegex },
};
const draft7 = new Ajv(options);
const draft2020 = new Ajv2020(options);
addFormats(draft7);
addFormats(draft2020);
/** Explicitly supported dialects: draft-07 (default) and 2020-12; no remote references. */
export function compileSchema(schema: unknown) {
  try {
    const raw = JSON.stringify(schema);
    if (raw.length > 65536) throw new Error();
    const dialect = (schema as { $schema?: string })?.$schema;
    return (
      dialect === "https://json-schema.org/draft/2020-12/schema"
        ? draft2020
        : draft7
    ).compile(schema as object);
  } catch {
    throw badRequest("Invalid or unsupported JSON Schema");
  }
}
export function assertSchema(schema: unknown, value: unknown) {
  if (!compileSchema(schema)(value))
    throw badRequest("Input does not satisfy JSON Schema");
}
export function assertRegex(pattern: string) {
  try {
    if (pattern.length > 2000) throw new Error();
    return RE2JS.compile(pattern);
  } catch {
    throw badRequest("Invalid or unsupported regular expression");
  }
}
