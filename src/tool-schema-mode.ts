/**
 * Opt-in compact tool schema (`CONTEXT_MODE_TOOL_SCHEMA=compact`).
 *
 * The full ctx_* tool definitions cost ~7,000 prompt tokens on every request:
 * each description carries WHEN / WHEN NOT / RETURNS sections, worked examples
 * and ranking internals. That is fine for a hosted model with a warm prompt
 * cache, and expensive on a local model that pays every cold prefill.
 *
 * Compact mode rewrites only the ADVERTISED `tools/list` payload:
 *   - one or two sentences per description, plus one example where the call
 *     shape is not obvious;
 *   - one-line parameter descriptions.
 *
 * Every tool stays advertised. Hosts such as Pi register only the tools that
 * `tools/list` returns, so hiding one would make it uncallable there, and the
 * shipped skills (ctx-purge, ctx-doctor, ...) still direct calls to them.
 *
 * Tools or parameters missing from the tables below pass through unchanged,
 * so a tool added upstream is never silently stripped of its documentation.
 * Validation and call behaviour are untouched — only wire text changes.
 */

export type ToolSchemaMode = "full" | "compact";

export const TOOL_SCHEMA_ENV = "CONTEXT_MODE_TOOL_SCHEMA";

/** Pure: an unrecognised value resolves to "full"; see toolSchemaModeWarning. */
export function resolveToolSchemaMode(env: NodeJS.ProcessEnv = process.env): ToolSchemaMode {
  return env[TOOL_SCHEMA_ENV]?.trim().toLowerCase() === "compact" ? "compact" : "full";
}

/** The diagnostic for an unrecognised value, or undefined when the value is valid or unset. */
export function toolSchemaModeWarning(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const raw = env[TOOL_SCHEMA_ENV]?.trim().toLowerCase();
  if (!raw || raw === "full" || raw === "compact") return undefined;
  return `[context-mode] ignoring ${TOOL_SCHEMA_ENV}=${JSON.stringify(raw)}; expected "full" or "compact"`;
}

/**
 * Parameters that exist only in some configurations, so the drift test does
 * not demand them from every registration (ctx_search.project appears only in
 * shared-DB mode, CONTEXT_MODE_PROJECT_DIR).
 */
export const CONDITIONAL_PARAMS: Readonly<Record<string, readonly string[]>> = {
  ctx_search: ["project"],
};

interface CompactText {
  description: string;
  params: Record<string, string>;
}

const INTENT =
  "What you are looking for. Output over ~5 KB is indexed and only matching section previews return; drill in with ctx_search.";

export const COMPACT_TOOL_TEXT: Readonly<Record<string, CompactText>> = {
  ctx_execute: {
    description:
      "Run code in a sandbox; only what it prints enters context. Use it to filter, count or summarize " +
      "large output (logs, repo-wide greps, API lists, test runs) instead of reading raw bytes. Use Bash " +
      "for short output you want verbatim and for file edits.\n" +
      "Example: ctx_execute(language: \"shell\", code: \"npm test 2>&1 | grep -E 'FAIL|passed'\")",
    params: {
      language: "Runtime.",
      code: "Source to run. Print only the summary you need.",
      timeout: "Max ms. Omit for no server-side limit.",
      background: "On timeout, detach and keep the process (server, watcher) running instead of killing it.",
      cwd: "Working directory for shell code.",
      intent: INTENT,
    },
  },
  ctx_execute_file: {
    description:
      "Load a file into the FILE_CONTENT variable and run code over it; only what the code prints enters " +
      "context. Use it to learn something about a large or structured file (counts, matches, parsed fields). " +
      "To edit a file, use Read instead.\n" +
      "Example: ctx_execute_file(path: \"app.log\", language: \"javascript\", code: \"console.log((FILE_CONTENT.match(/ERROR/g) || []).length)\")",
    params: {
      path: "File to load.",
      language: "Runtime.",
      code: "Code that reads FILE_CONTENT (file_content in Elixir) and prints the result.",
      timeout: "Max ms.",
      intent: INTENT,
    },
  },
  ctx_batch_execute: {
    description:
      "Run several shell commands in one call. All output is indexed, and the sections matching `queries` " +
      "come back inline, so no follow-up search is needed.\n" +
      "Example: ctx_batch_execute(commands: [{label: \"log\", command: \"git log -20\"}, {label: \"diff\", command: \"git diff\"}], queries: [\"auth change\"])",
    params: {
      commands: "Commands to run; each output is labelled with its `label`.",
      queries: "Questions to answer from the output. Put all of them here.",
      timeout: "Max ms (shared budget if concurrency is 1, per command otherwise).",
      concurrency: "Parallel commands, 1-8. Use >1 only for I/O-bound, independent commands.",
      cwd: "Working directory.",
      query_scope: "`batch` searches only this batch's output; `global` searches the whole index.",
    },
  },
  ctx_search: {
    description:
      "Search the knowledge base: content stored by ctx_index, ctx_fetch_and_index and batch output, plus " +
      "captured session events (decisions, errors, plans). Batch all questions in one call.",
    params: {
      queries: "Queries; 2-4 specific technical terms each.",
      limit: "Results per query.",
      source: "Restrict to one source label (partial match).",
      contentType: "Return only code or only prose.",
      sort: "`relevance` (current session) or `timeline` (all sessions, chronological).",
      project: "Omit for this project; `global` for every project; or an absolute project path.",
    },
  },
  ctx_index: {
    description:
      "Store text or a file/directory in the searchable knowledge base without putting it in context; " +
      "query it later with ctx_search. Use for docs and references you will look up again.",
    params: {
      content: "Text to index (or use path).",
      path: "File or directory to index (or use content).",
      source: "Label to search by later.",
      include: "Directory only: globs to include.",
      exclude: "Directory only: globs to exclude.",
      maxDepth: "Directory only: max depth (default 5).",
      maxFiles: "Directory only: max files (default 200).",
      extensions: "Directory only: file extensions to include.",
      respectGitignore: "Directory only: honour .gitignore (default true).",
      followSymlinks: "Directory only: follow symlinks.",
    },
  },
  ctx_fetch_and_index: {
    description:
      "Fetch URLs (plain HTTP, no browser), convert to markdown and index them; only a short preview enters " +
      "context, the rest is searchable with ctx_search. Fetches are cached for 24 h.",
    params: {
      url: "Single URL to fetch.",
      source: "Label for a single `url`.",
      requests: "Batch of {url, source?} entries.",
      concurrency: "Parallel fetches, 1-8.",
      force: "Bypass the cache.",
      ttl: "Cache window in ms for this call; 0 bypasses the cache.",
    },
  },
  ctx_stats: {
    description: "Context-savings statistics for this session: bytes returned per tool, call counts, estimated tokens.",
    params: {},
  },
  ctx_doctor: {
    description: "Diagnose the context-mode installation; returns an [OK]/[WARN]/[FAIL] report.",
    params: {},
  },
  ctx_upgrade: {
    description:
      "Returns a shell command that upgrades context-mode. Run it with your shell tool, show the output, " +
      "and tell the user to restart the session.",
    params: {},
  },
  ctx_insight: {
    description: "Open the hosted context-mode Insight analytics dashboard in the browser. Not a search tool.",
    params: {},
  },
  ctx_purge: {
    description:
      "DESTRUCTIVE, cannot be undone: delete indexed content. Only when the user explicitly asks; if they do " +
      "not name a scope, ask which. Pass confirm: true and exactly one of sessionId (one session) or " +
      "scope: \"project\" (the whole knowledge base, all sessions and stats).",
    params: {
      confirm: "Must be true; false cancels.",
      sessionId: "UUID of the one session to delete. Do not combine with scope: \"project\".",
      scope: "`project` wipes everything; `session` requires sessionId.",
    },
  },
};

type WireTool = {
  name?: unknown;
  description?: unknown;
  inputSchema?: unknown;
};

function compactSchema(schema: unknown, params: Record<string, string>): unknown {
  if (!schema || typeof schema !== "object" || Array.isArray(schema)) return schema;
  const { $schema: _drop, ...rest } = schema as Record<string, unknown>;
  const props = rest.properties;
  if (props && typeof props === "object" && !Array.isArray(props)) {
    const next: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(props as Record<string, unknown>)) {
      const text = params[key];
      next[key] = text !== undefined && value && typeof value === "object"
        ? { ...(value as Record<string, unknown>), description: text }
        : value;
    }
    rest.properties = next;
  }
  return rest;
}

/** Rewrite a `tools/list` array for compact mode. Pure: returns new objects. */
export function compactToolsList<T extends WireTool>(tools: readonly T[]): T[] {
  return tools.map((tool) => {
    const text = typeof tool?.name === "string" ? COMPACT_TOOL_TEXT[tool.name] : undefined;
    if (!text) return tool;
    return { ...tool, description: text.description, inputSchema: compactSchema(tool.inputSchema, text.params) };
  });
}
