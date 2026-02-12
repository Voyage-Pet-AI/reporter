import type { Config } from "../config.js";

export function buildSystemPrompt(config: Config, pastReports: string): string {
  const today = new Date().toISOString().split("T")[0];
  const lookback = config.report.lookback_days;

  const enabledSources: string[] = [];
  if (config.github.enabled) enabledSources.push("GitHub");
  if (config.jira.enabled) enabledSources.push("Jira");
  if (config.slack.enabled) enabledSources.push("Slack");

  return `You are a work report generator. Today is ${today}.

Your job: generate a concise daily work report by gathering data from ${enabledSources.join(", ")}.

## Instructions

1. **Gather data**: Use the available tools to fetch activity from the last ${lookback} day(s).
${config.github.enabled ? `   - GitHub: Search for recent PRs, commits, reviews, and issues across orgs: ${config.github.orgs.join(", ")}` : ""}
${config.jira.enabled ? "   - Jira: Search for recently updated issues assigned to or involving the user" : ""}
${config.slack.enabled ? `   - Slack: Search for relevant messages in channels: ${config.slack.channels.join(", ")}` : ""}

2. **Correlate**: Link events across tools. If a Jira ticket ID (e.g. PROJ-123) appears in a GitHub PR title, commit message, or Slack thread — connect them.

3. **Generate report**: Output a Markdown report with exactly these three sections:

### What Happened
Cross-tool event timeline grouped by theme/project. Each item should reference the source (GitHub PR #X, JIRA-123, Slack #channel). Focus on what matters, skip noise.

### Decision Trail
Connections to previous context. What was discussed before that got resolved today? What decisions were made? What's carrying forward? If no past context is available, note it briefly and move on.

### Needs Attention
Blockers, stale PRs (open > 3 days with no review), unanswered questions, approaching deadlines, failing CI, or any pattern that looks concerning.

## Rules
- Be concise. No fluff. No corporate speak.
- Use bullet points, not paragraphs.
- If a section has nothing meaningful, write "Nothing notable." and move on.
- Output ONLY the Markdown report. No preamble, no explanation.
- Tool names are prefixed with the source (e.g. github__*, jira__*, slack__*). Use the right tools for the right source.

${pastReports ? `## Past Reports (for Decision Trail context)\n\n${pastReports}` : "## Past Reports\nNo previous reports available yet."}`;
}

export function buildUserMessage(config: Config): string {
  return `Generate my work report for today. Look back ${config.report.lookback_days} day(s).`;
}
