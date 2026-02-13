import * as readline from "readline";
import { Writable } from "stream";
import pc from "picocolors";

const silentOutput = new Writable({
  write(_chunk, _encoding, callback) {
    callback();
  },
});

export interface MultiselectItem<T> {
  value: T;
  label: string;
  hint?: string;
}

export interface MultiselectOptions<T> {
  message: string;
  items: MultiselectItem<T>[];
  maxVisible?: number;
}

const S_STEP_ACTIVE = pc.green("◆");
const S_STEP_CANCEL = pc.red("■");
const S_STEP_SUBMIT = pc.green("◇");
const S_RADIO_ACTIVE = pc.green("●");
const S_RADIO_INACTIVE = pc.dim("○");
const S_BAR = pc.dim("│");

export const cancelSymbol = Symbol("cancel");

export async function multiselect<T>(
  options: MultiselectOptions<T>,
): Promise<T[] | symbol> {
  const { message, items, maxVisible = 8 } = options;

  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: silentOutput,
      terminal: false,
    });

    if (process.stdin.isTTY) {
      process.stdin.setRawMode(true);
    }
    readline.emitKeypressEvents(process.stdin, rl);

    let cursor = 0;
    const selected = new Set<T>();
    let lastRenderHeight = 0;

    const clearRender = (): void => {
      if (lastRenderHeight > 0) {
        process.stderr.write(`\x1b[${lastRenderHeight}A`);
        for (let i = 0; i < lastRenderHeight; i++) {
          process.stderr.write("\x1b[2K\x1b[1B");
        }
        process.stderr.write(`\x1b[${lastRenderHeight}A`);
      }
    };

    const render = (
      state: "active" | "submit" | "cancel" = "active",
    ): void => {
      clearRender();

      const lines: string[] = [];

      const icon =
        state === "active"
          ? S_STEP_ACTIVE
          : state === "cancel"
            ? S_STEP_CANCEL
            : S_STEP_SUBMIT;
      lines.push(`${icon}  ${pc.bold(message)}`);

      if (state === "active") {
        lines.push(
          `${S_BAR}  ${pc.dim("↑↓ move, space select, enter confirm")}`,
        );
        lines.push(`${S_BAR}`);

        // Visible window
        const visibleStart = Math.max(
          0,
          Math.min(
            cursor - Math.floor(maxVisible / 2),
            items.length - maxVisible,
          ),
        );
        const visibleEnd = Math.min(items.length, visibleStart + maxVisible);
        const visibleItems = items.slice(visibleStart, visibleEnd);

        for (let i = 0; i < visibleItems.length; i++) {
          const item = visibleItems[i]!;
          const actualIndex = visibleStart + i;
          const isSelected = selected.has(item.value);
          const isCursor = actualIndex === cursor;

          const radio = isSelected ? S_RADIO_ACTIVE : S_RADIO_INACTIVE;
          const label = isCursor ? pc.underline(item.label) : item.label;
          const hint = item.hint ? pc.dim(`  ${item.hint}`) : "";

          const prefix = isCursor ? pc.cyan("❯") : " ";
          lines.push(`${S_BAR} ${prefix} ${radio} ${label}${hint}`);
        }

        // Scroll indicators
        const hiddenBefore = visibleStart;
        const hiddenAfter = items.length - visibleEnd;
        if (hiddenBefore > 0 || hiddenAfter > 0) {
          const parts: string[] = [];
          if (hiddenBefore > 0) parts.push(`↑ ${hiddenBefore} more`);
          if (hiddenAfter > 0) parts.push(`↓ ${hiddenAfter} more`);
          lines.push(`${S_BAR}  ${pc.dim(parts.join("  "))}`);
        }

        // Selected summary
        lines.push(`${S_BAR}`);
        const selectedLabels = items
          .filter((item) => selected.has(item.value))
          .map((item) => item.label);
        if (selectedLabels.length === 0) {
          lines.push(`${S_BAR}  ${pc.dim("Selected: (none)")}`);
        } else {
          const summary =
            selectedLabels.length <= 3
              ? selectedLabels.join(", ")
              : `${selectedLabels.slice(0, 3).join(", ")} +${selectedLabels.length - 3} more`;
          lines.push(`${S_BAR}  ${pc.green("Selected:")} ${summary}`);
        }

        lines.push(`${pc.dim("└")}`);
      } else if (state === "submit") {
        const selectedLabels = items
          .filter((item) => selected.has(item.value))
          .map((item) => item.label);
        lines.push(
          `${S_BAR}  ${pc.dim(selectedLabels.join(", ") || "(none)")}`,
        );
      } else if (state === "cancel") {
        lines.push(`${S_BAR}  ${pc.strikethrough(pc.dim("Cancelled"))}`);
      }

      process.stderr.write(lines.join("\n") + "\n");
      lastRenderHeight = lines.length;
    };

    const cleanup = (): void => {
      process.stdin.removeListener("keypress", keypressHandler);
      if (process.stdin.isTTY) {
        process.stdin.setRawMode(false);
      }
      rl.close();
    };

    const submit = (): void => {
      render("submit");
      cleanup();
      resolve(Array.from(selected));
    };

    const cancel = (): void => {
      render("cancel");
      cleanup();
      resolve(cancelSymbol);
    };

    const keypressHandler = (_str: string, key: readline.Key): void => {
      if (!key) return;

      if (key.name === "return") {
        submit();
        return;
      }

      if (key.name === "escape" || (key.ctrl && key.name === "c")) {
        cancel();
        return;
      }

      if (key.name === "up") {
        cursor = Math.max(0, cursor - 1);
        render();
        return;
      }

      if (key.name === "down") {
        cursor = Math.min(items.length - 1, cursor + 1);
        render();
        return;
      }

      if (key.name === "space") {
        const item = items[cursor];
        if (item) {
          if (selected.has(item.value)) {
            selected.delete(item.value);
          } else {
            selected.add(item.value);
          }
        }
        render();
        return;
      }
    };

    process.stdin.on("keypress", keypressHandler);
    render();
  });
}
