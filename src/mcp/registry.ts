import type { Config } from "../config.js";
import { resolveSecret } from "../config.js";

export interface ServerEntry {
  name: string;
  command: string;
  args: string[];
  env: Record<string, string>;
}

export function getEnabledServers(config: Config): ServerEntry[] {
  const servers: ServerEntry[] = [];

  if (config.github.enabled) {
    const token = resolveSecret(config.github.token_env);
    if (!token) {
      throw new Error(
        `GitHub enabled but token not configured — set ${config.github.token_env} in environment or put the token directly in config`
      );
    }
    servers.push({
      name: "github",
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-github"],
      env: { GITHUB_PERSONAL_ACCESS_TOKEN: token },
    });
  }

  if (config.jira.enabled) {
    servers.push({
      name: "jira",
      command: "npx",
      args: ["-y", "mcp-remote", config.jira.url],
      env: {},
    });
  }

  if (config.slack.enabled) {
    const token = resolveSecret(config.slack.token_env);
    if (!token) {
      throw new Error(
        `Slack enabled but token not configured — set ${config.slack.token_env} in environment or put the token directly in config`
      );
    }
    servers.push({
      name: "slack",
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-slack"],
      env: { SLACK_BOT_TOKEN: token },
    });
  }

  return servers;
}
