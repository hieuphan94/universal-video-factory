// tree-id client — fetches content from knowledge base by node ID
// TODO: Replace stub with real tree-id API calls when available
// Currently reads from a local sample JSON file (data/tree-id-sample.json)

import * as fs from "fs";
import * as path from "path";
import type { TreeNode, TreeIdConfig } from "./tree-id-types.js";

const DEFAULT_SAMPLE_PATH = path.resolve("data/tree-id-sample.json");

/** Fetch a tree-id node by ID. Uses sample data until real API is connected. */
export async function fetchTreeNode(
  nodeId: string,
  config?: TreeIdConfig
): Promise<TreeNode> {
  const source = config?.source ?? DEFAULT_SAMPLE_PATH;

  // Local file mode — read from JSON
  if (source.endsWith(".json") || !source.startsWith("http")) {
    return fetchFromFile(nodeId, source);
  }

  // Remote API mode — HTTP fetch (placeholder for real API)
  return fetchFromApi(nodeId, source, config?.apiKey);
}

/** Read node from local JSON file */
function fetchFromFile(nodeId: string, filePath: string): TreeNode {
  if (!fs.existsSync(filePath)) {
    throw new Error(`tree-id sample file not found: ${filePath}. Create it or provide --tree-id-source.`);
  }

  const data = JSON.parse(fs.readFileSync(filePath, "utf-8"));
  const nodes: TreeNode[] = Array.isArray(data) ? data : data.nodes ?? [];
  const node = nodes.find((n) => n.id === nodeId);

  if (!node) {
    const ids = nodes.map((n) => n.id).join(", ");
    throw new Error(`Node "${nodeId}" not found in tree-id. Available: ${ids}`);
  }

  return node;
}

/** Fetch node from remote tree-id API (stub — replace with real implementation) */
async function fetchFromApi(
  nodeId: string,
  baseUrl: string,
  apiKey?: string
): Promise<TreeNode> {
  const url = `${baseUrl}/nodes/${nodeId}`;
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`;

  const res = await fetch(url, { headers });
  if (!res.ok) {
    throw new Error(`tree-id API error: ${res.status} ${res.statusText}`);
  }

  return (await res.json()) as TreeNode;
}
