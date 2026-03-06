// Types for tree-id knowledge base integration
// TODO: Replace sample types with real tree-id API schema when available

export interface TreeNode {
  id: string;
  title: string;
  url: string;
  description: string;
  tags: string[];
  createdAt: string;
}

export interface TreeIdConfig {
  /** API base URL (e.g. http://localhost:3000/api) or path to local JSON file */
  source: string;
  /** API key if using remote tree-id instance */
  apiKey?: string;
}
