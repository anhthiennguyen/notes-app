import { NextRequest } from "next/server";

export async function POST(req: NextRequest) {
  const { messages } = await req.json();

  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    return new Response(
      JSON.stringify({ error: "GROQ_API_KEY is not set" }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }

  const groqRes = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: "llama-3.3-70b-versatile",
      messages,
      stream: true,
    }),
  }).catch(() => null);

  if (!groqRes) {
    return new Response(
      JSON.stringify({ error: "Could not reach Groq API" }),
      { status: 503, headers: { "Content-Type": "application/json" } }
    );
  }

  if (!groqRes.ok) {
    const detail = await groqRes.text().catch(() => "");
    return new Response(
      JSON.stringify({ error: `Groq error: ${detail || groqRes.statusText}` }),
      { status: 502, headers: { "Content-Type": "application/json" } }
    );
  }

  // Groq streams OpenAI-compatible SSE: data: {"choices":[{"delta":{"content":"..."}}]}
  // Transform to the NDJSON format the client expects: {"message":{"content":"..."}}
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const reader = groqRes.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const json = line.slice(6).trim();
          if (json === "[DONE]") continue;
          try {
            const parsed = JSON.parse(json);
            const text = parsed.choices?.[0]?.delta?.content ?? "";
            if (text) {
              controller.enqueue(
                encoder.encode(JSON.stringify({ message: { content: text } }) + "\n")
              );
            }
          } catch {
            // partial or non-JSON line, skip
          }
        }
      }
      controller.close();
    },
  });

  return new Response(stream, {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}
