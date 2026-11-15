export function toWebVtt(source: string): string {
  const text = source.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n").trim();
  if (!text.includes("-->")) throw new Error("This subtitle file has no timed captions.");
  const result = /^WEBVTT(?:\s|$)/.test(text)
    ? text + "\n"
    : "WEBVTT\n\n" + text.replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, "$1.$2") + "\n";
  if (new TextEncoder().encode(result).length > 65_536) throw new Error("Subtitle files must be 64 KB or smaller.");
  return result;
}
