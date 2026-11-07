/**
 * What is actually read aloud: Markdown and URLs removed (TTS would read the
 * symbols), capped near 1200 characters at a sentence boundary. Long,
 * symbol-heavy replies were the requests that timed out or came back without
 * audio.
 */
export function speechText(text: string): string {
  const plain = text
    .replace(/\[([^\]]+)\]\((?:[^)]+)\)/g, "$1")
    .replace(/https?:\/\/\S+/g, "")
    .replace(/[*_#>`|~]+/g, " ")
    .replace(/^\s*[-•]\s+/gm, "")
    .replace(/\s+/g, " ")
    .trim();
  if (plain.length <= 1200) return plain;
  const cut = plain.slice(0, 1200);
  const end = Math.max(
    cut.lastIndexOf("."),
    cut.lastIndexOf("؟"),
    cut.lastIndexOf("!"),
    cut.lastIndexOf("؛"),
  );
  return (end > 600 ? cut.slice(0, end + 1) : cut).trim();
}
