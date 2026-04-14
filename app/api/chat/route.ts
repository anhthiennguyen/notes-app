import { NextRequest } from "next/server";

export async function POST(req: NextRequest) {
  const { messages } = await req.json();

  const ollamaRes = await fetch("http://localhost:11434/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "llama3.2:3b",
      messages,
      stream: true,
    }),
  }).catch(() => null);

  if (!ollamaRes) {
    return new Response(
      JSON.stringify({ error: "Ollama isn't running or installed. Try: ollama serve" }),
      { status: 503, headers: { "Content-Type": "application/json" } }
    );
  }

  if (!ollamaRes.ok) {
    const detail = await ollamaRes.text().catch(() => "");
    return new Response(
      JSON.stringify({ error: `Ollama error: ${detail || ollamaRes.statusText}` }),
      { status: 502, headers: { "Content-Type": "application/json" } }
    );
  }

  // Forward the stream back to the client
  return new Response(ollamaRes.body, {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}
