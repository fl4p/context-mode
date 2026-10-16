import { describe, expect, test } from "vitest";
import {
  COMPACT_TOOL_TEXT,
  CONDITIONAL_PARAMS,
  TOOL_SCHEMA_ENV,
  compactToolsList,
  resolveToolSchemaMode,
  toolSchemaModeWarning,
} from "../../src/tool-schema-mode.js";
import { REGISTERED_CTX_TOOLS } from "../../src/server.js";
import { buildCtxSearchInputSchema } from "../../src/search/ctx-search-schema.js";

describe("resolveToolSchemaMode", () => {
  test("defaults to full", () => {
    expect(resolveToolSchemaMode({})).toBe("full");
    expect(resolveToolSchemaMode({ [TOOL_SCHEMA_ENV]: "" })).toBe("full");
    expect(resolveToolSchemaMode({ [TOOL_SCHEMA_ENV]: "full" })).toBe("full");
  });

  test("accepts compact case-insensitively", () => {
    expect(resolveToolSchemaMode({ [TOOL_SCHEMA_ENV]: " Compact " })).toBe("compact");
  });

  test("an unknown value resolves to full and yields a warning", () => {
    expect(resolveToolSchemaMode({ [TOOL_SCHEMA_ENV]: "tiny" })).toBe("full");
    expect(toolSchemaModeWarning({ [TOOL_SCHEMA_ENV]: "tiny" })).toContain(TOOL_SCHEMA_ENV);
  });

  test("valid or unset values yield no warning", () => {
    for (const value of [undefined, "", "full", "compact", " COMPACT "]) {
      expect(toolSchemaModeWarning({ [TOOL_SCHEMA_ENV]: value })).toBeUndefined();
    }
  });
});

describe("compactToolsList", () => {
  const schema = {
    $schema: "http://json-schema.org/draft-07/schema#",
    type: "object",
    properties: {
      language: { type: "string", enum: ["javascript", "shell"], description: "Runtime language" },
      code: { type: "string", description: "x".repeat(500) },
      undocumented: { type: "string", description: "kept as is" },
    },
    required: ["language", "code"],
  };

  test("keeps every tool advertised, in order", () => {
    const tools = REGISTERED_CTX_TOOLS.map((t) => ({ name: t.name, description: "d" }));
    expect(compactToolsList(tools).map((t) => t.name)).toEqual(tools.map((t) => t.name));
  });

  test("rewrites descriptions and parameter text, keeps types, enums and required", () => {
    const [tool] = compactToolsList([{ name: "ctx_execute", description: "long".repeat(1000), inputSchema: schema }]);
    expect(tool.description).toBe(COMPACT_TOOL_TEXT.ctx_execute.description);
    const out = tool.inputSchema as typeof schema;
    expect(out.$schema).toBeUndefined();
    expect(out.required).toEqual(["language", "code"]);
    expect(out.properties.language).toEqual({
      type: "string",
      enum: ["javascript", "shell"],
      description: COMPACT_TOOL_TEXT.ctx_execute.params.language,
    });
    expect(out.properties.code.description).toBe(COMPACT_TOOL_TEXT.ctx_execute.params.code);
    expect(out.properties.undocumented.description).toBe("kept as is");
  });

  test("passes unknown tools through untouched", () => {
    const unknown = { name: "ctx_future_tool", description: "full text", inputSchema: schema };
    expect(compactToolsList([unknown])).toEqual([unknown]);
  });

  test("does not mutate its input", () => {
    const input = { name: "ctx_execute", description: "orig", inputSchema: structuredClone(schema) };
    const before = structuredClone(input);
    compactToolsList([input]);
    expect(input).toEqual(before);
  });

  test("keeps language-specific variable names the executor relies on", () => {
    expect(COMPACT_TOOL_TEXT.ctx_execute_file.params.code).toContain("file_content in Elixir");
  });
});

describe("compact tables track the registered tools", () => {
  const registered = new Map(REGISTERED_CTX_TOOLS.map((t) => [t.name, t]));
  const keysOf = (inputSchema: unknown): string[] => {
    const input = (inputSchema ?? {}) as { shape?: Record<string, unknown> };
    return Object.keys(input.shape ?? (input as Record<string, unknown>)).sort();
  };

  test("registry is populated", () => {
    expect(registered.size).toBeGreaterThan(0);
  });

  test("every registered tool has compact text", () => {
    for (const name of registered.keys()) expect(name in COMPACT_TOOL_TEXT, `${name} has no compact text`).toBe(true);
  });

  test("every registered parameter has compact text, and every compact parameter exists", () => {
    for (const [name, text] of Object.entries(COMPACT_TOOL_TEXT)) {
      const tool = registered.get(name);
      expect(tool, `${name} is not registered`).toBeDefined();
      const actual = keysOf(tool!.config.inputSchema);
      const conditional = CONDITIONAL_PARAMS[name] ?? [];
      for (const key of actual) expect(key in text.params, `${name}.${key} has no compact text`).toBe(true);
      for (const key of Object.keys(text.params)) {
        expect(actual.includes(key) || conditional.includes(key), `${name}.${key} is not a parameter`).toBe(true);
      }
    }
  });

  test("shared-DB mode parameters are covered too", () => {
    for (const key of keysOf(buildCtxSearchInputSchema(true))) {
      expect(key in COMPACT_TOOL_TEXT.ctx_search.params, `ctx_search.${key} has no compact text`).toBe(true);
    }
  });
});
