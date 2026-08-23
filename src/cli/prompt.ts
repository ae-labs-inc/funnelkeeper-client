// Terminal prompts: plain, hidden, and typed-confirmation.
import readline from "node:readline";

export function ask(question: string): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) =>
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    }));
}

export function askHidden(question: string): Promise<string> {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const anyRl = rl as unknown as { _writeToOutput: (s: string) => void; output: NodeJS.WritableStream };
    process.stdout.write(question);
    anyRl._writeToOutput = () => {}; // mute echo
    rl.question("", (answer) => {
      rl.close();
      process.stdout.write("\n");
      resolve(answer.trim());
    });
  });
}

/** Destructive actions require the word itself — not y, not enter. */
export async function confirmTyped(prompt: string): Promise<boolean> {
  const answer = await ask(`${prompt} type yes to continue: `);
  return answer.toLowerCase() === "yes";
}
