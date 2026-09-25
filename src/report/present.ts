// Interactive presentation: a progress spinner while logs are read, the report
// revealed line by line, and a key menu (full report / share / open card / quit).
// Everything degrades to plain output when stdout is not a terminal.

const FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

/** Whether to animate: an interactive terminal, not CI, not disabled. */
export function canAnimate(stream: NodeJS.WriteStream, disabled: boolean): boolean {
  return stream.isTTY === true && !disabled && !process.env.CI && !process.env.NO_ANIMATION;
}

/** A one-line spinner on stderr. `set` updates its text; `stop` clears the line. */
export class Spinner {
  private text = "";
  private i = 0;
  private timer?: NodeJS.Timeout;
  private out: NodeJS.WriteStream;

  constructor(out: NodeJS.WriteStream, enabled: boolean) {
    this.out = out;
    if (enabled) {
      this.timer = setInterval(() => this.draw(), 80);
      this.timer.unref();
    }
  }

  set(text: string): void {
    this.text = text;
    if (this.timer) this.draw();
  }

  private draw(): void {
    const width = Math.max(20, (this.out.columns || 80) - 3);
    const line = this.text.length > width ? this.text.slice(0, width - 1) + "…" : this.text;
    this.out.write(`\r\x1b[K\x1b[36m${FRAMES[this.i++ % FRAMES.length]}\x1b[0m ${line}`);
  }

  stop(): void {
    if (!this.timer) return;
    clearInterval(this.timer);
    this.timer = undefined;
    this.out.write("\r\x1b[K");
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const visible = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, "");

/**
 * Writes text line by line: a short pause per line and a longer one before each
 * section heading (a line that starts at column 0), like the README demo.
 */
export async function reveal(out: NodeJS.WriteStream, text: string, animate: boolean): Promise<void> {
  if (!animate) {
    out.write(text);
    return;
  }
  const lines = text.replace(/\n$/, "").split("\n");
  for (const line of lines) {
    const plain = visible(line);
    await sleep(plain.trim() === "" ? 60 : /^\S/.test(plain) ? 140 : 28);
    out.write(line + "\n");
  }
}

export interface MenuItem {
  key: string;
  label: string;
  /**
   * Runs the action; return true to close the menu afterwards. `ask` asks a yes/no
   * question with a single key press while the menu owns the keyboard.
   */
  run: (ask: (question: string) => Promise<boolean>) => Promise<boolean | void> | boolean | void;
}

/**
 * A single-key menu on an interactive terminal. `items` is re-read after every
 * action, so entries can come and go. Resolves when the user quits.
 */
export async function keyMenu(out: NodeJS.WriteStream, items: () => MenuItem[], color: boolean): Promise<void> {
  const stdin = process.stdin;
  if (!stdin.isTTY) return;
  const b = (s: string) => (color ? `\x1b[1;33m${s}\x1b[0m` : s);
  const prompt = () => out.write(`\n${items().map((i) => `${b(`[${i.key}]`)} ${i.label}`).join("   ")}   ${b("[q]")} quit\n`);
  prompt();
  stdin.setRawMode(true);
  stdin.resume();
  let answer: ((k: string) => void) | undefined;
  const ask = (question: string) =>
    new Promise<boolean>((resolve) => {
      out.write(question);
      answer = (k) => {
        answer = undefined;
        const yes = k === "y";
        out.write(yes ? "yes\n" : "no\n");
        resolve(yes);
      };
    });
  await new Promise<void>((resolve) => {
    let busy = false;
    const done = () => {
      stdin.off("data", onKey);
      stdin.setRawMode(false);
      stdin.pause();
      resolve();
    };
    const onKey = async (buf: Buffer) => {
      const k = buf.toString("utf8").toLowerCase();
      if (k === "\u0003") return done();
      if (answer) return answer(k);
      if (busy) return;
      if (k === "q" || k === "\u001b" || k === "\r") return done();
      const item = items().find((i) => i.key === k);
      if (!item) return;
      busy = true;
      const close = await item.run(ask);
      busy = false;
      if (close) return done();
      prompt();
    };
    stdin.on("data", onKey);
  });
}
