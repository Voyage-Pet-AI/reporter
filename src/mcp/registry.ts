import type { Config } from "../config.js";

export interface ServerEntry {
  name: string;
  command: string;
  args: string[];
  env: Record<string, string>;
}

export function getEnabledServers(config: Config): ServerEntry[] {
  const servers: ServerEntry[] = [];

  if (config.github.enabled) {
    const token = process.env[config.github.token_env];
    if (!token) {
      throw new Error(
        `GitHub enabled but ${config.github.token_env} not set in environment`
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
    const token = process.env[config.slack.token_env];
    if (!token) {
      throw new Error(
        `Slack enabled but ${config.slack.token_env} not set in environment`
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
