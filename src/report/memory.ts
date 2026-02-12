import { readFileSync, writeFileSync, readdirSync, mkdirSync, existsSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import type { Config } from "../config.js";

function resolveDir(config: Config): string {
  const dir = config.report.output_dir.replace("~", homedir());
  mkdirSync(dir, { recursive: true });
  return dir;
}

export function loadPastReports(config: Config): string {
  const dir = resolveDir(config);
  if (!existsSync(dir)) return "";

  const files = readdirSync(dir)
    .filter((f) => f.endsWith(".md"))
    .sort()
    .reverse()
    .slice(0, config.report.memory_depth);

  if (files.length === 0) return "";

  return files
    .map((f) => {
      const content = readFileSync(join(dir, f), "utf-8");
      const date = f.replace(".md", "");
      return `--- Report from ${date} ---\n${content}`;
    })
    .join("\n\n");
}

export function saveReport(config: Config, report: string): string {
  const dir = resolveDir(config);
  const date = new Date().toISOString().split("T")[0];
  const path = join(dir, `${date}.md`);
  writeFileSync(path, report);
  return path;
}

export function listReports(config: Config): string[] {
  const dir = resolveDir(config);
  if (!existsSync(dir)) return [];

  return readdirSync(dir)
    .filter((f) => f.endsWith(".md"))
    .sort()
    .reverse();
}
