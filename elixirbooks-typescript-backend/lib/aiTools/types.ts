/**
 * Shared types for the grounded financial tool registry (Cluster H, slice
 * H.3).
 *
 * The provider abstraction in `lib/aiProviders/types.ts` already declares
 * the canonical `ToolDef` shape that providers consume. This module
 * re-exports it and layers on a couple of registry-level helpers so the
 * controller and the tool definitions agree on a single source of truth.
 */
import type { ToolDef } from '../aiProviders/types';

export type { ToolDef } from '../aiProviders/types';

/**
 * Context passed to every tool handler. Always carries the authenticated
 * user id so handlers can scope their Prisma queries to that tenant.
 */
export interface ToolContext {
  userId: string;
}

/**
 * A handler takes validated args (already parsed JSON from the model) plus
 * the tenant context and returns a plain JSON-serializable result.
 */
export type ToolHandler = (
  args: Record<string, unknown>,
  ctx: ToolContext,
) => Promise<unknown>;

/**
 * Map of tool name → definition. Built once from `financialTools` and used
 * by the chat controller to dispatch tool calls coming back from the
 * provider stream.
 */
export type ToolRegistry = Record<string, ToolDef>;

/**
 * Builds a name→def lookup from an array of tool definitions.
 */
export function buildToolRegistry(tools: ToolDef[]): ToolRegistry {
  const registry: ToolRegistry = {};
  for (const tool of tools) {
    registry[tool.name] = tool;
  }
  return registry;
}
