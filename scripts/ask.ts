/**
 * Ask the SpineFind assistant from the command line (against DATABASE_URL / ASSISTANT_DATABASE_URL):
 *
 *   npx tsx --conditions=react-server scripts/ask.ts "Which films have I watched the most?"
 *
 * Prints the answer, the tools it used and what it cost. Each question costs a few pence.
 */
import { ask } from "../src/lib/assistant/run";

const question = process.argv.slice(2).join(" ").trim();
if (!question) {
  console.error('Usage: scripts/ask.ts "your question"');
  process.exit(1);
}
async function main() {
  const t = Date.now();
  await ask(null, question, (e) => {
    if (e.type === "text") process.stdout.write(e.delta);
    else if (e.type === "status") process.stdout.write(`\n  [${e.text}]\n`);
    else if (e.type === "error") console.error(`\nERROR: ${e.message}`);
    else if (e.type === "done") console.log(`\n\n— ${((Date.now() - t) / 1000).toFixed(1)}s, $${e.costUsd.toFixed(4)}`);
  });
}

main().then(() => process.exit(0), (e) => {
  console.error(e);
  process.exit(1);
});
