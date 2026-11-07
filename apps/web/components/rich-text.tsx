export function RichText({ text }: { text: string }) {
  const parts = text.split(/(https?:\/\/[^\s<>]+|\*\*[^*]+\*\*)/g);
  let offset = 0;
  const chunks = parts.map((part) => {
    const start = offset;
    offset += part.length;
    return { part, start };
  });
  return (
    <div className="prose" dir="auto">
      {chunks.map(({ part, start }) => {
        if (part.startsWith("http")) {
          try {
            const url = new URL(part.replace(/[).,،]+$/u, ""));
            if (["http:", "https:"].includes(url.protocol))
              return (
                <a
                  key={`${start}-${part}`}
                  href={url.href}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {url.hostname} ↗
                </a>
              );
          } catch {
            /* Render unsafe/invalid URLs as text. */
          }
        }
        if (part.startsWith("**"))
          return <strong key={`${start}-${part}`}>{part.slice(2, -2)}</strong>;
        return <span key={`${start}-${part}`}>{part}</span>;
      })}
    </div>
  );
}
