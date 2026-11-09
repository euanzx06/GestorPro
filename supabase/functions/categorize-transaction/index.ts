const corsHeaders = (origin: string, allowedOrigin: string) => ({
  "Access-Control-Allow-Origin": origin === allowedOrigin ? origin : "null",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Vary": "Origin",
});

const json = (body: unknown, status: number, headers: Record<string, string>) =>
  new Response(JSON.stringify(body), { status, headers: { ...headers, "Content-Type": "application/json" } });

Deno.serve(async (request) => {
  const origin = request.headers.get("Origin") ?? "";
  const allowedOrigins = (Deno.env.get("GESTORPRO_ALLOWED_ORIGINS") ?? "http://localhost:5500,http://127.0.0.1:5500")
    .split(",").map((value) => value.trim()).filter(Boolean);
  const allowedOrigin = allowedOrigins.includes(origin) ? origin : "";
  const headers = corsHeaders(origin, allowedOrigin);

  if (request.method === "OPTIONS") return new Response("ok", { headers });
  if (request.method !== "POST") return json({ error: "Método não permitido." }, 405, headers);
  if (!allowedOrigin) return json({ error: "Origem não autorizada." }, 403, headers);
  if (!request.headers.get("Authorization")?.startsWith("Bearer ")) {
    return json({ error: "Entre na sua conta para usar o assistente." }, 401, headers);
  }

  const apiKey = Deno.env.get("OPENAI_API_KEY");
  if (!apiKey) return json({ error: "A integração com a IA ainda não foi configurada." }, 503, headers);

  try {
    const body = await request.json();
    const message = typeof body.message === "string" ? body.message.trim() : "";
    if (!message || message.length > 500) return json({ error: "A descrição deve ter entre 1 e 500 caracteres." }, 400, headers);

    const history = Array.isArray(body.history) ? body.history.slice(-8).flatMap((item: unknown) => {
      if (!item || typeof item !== "object") return [];
      const entry = item as { role?: unknown; text?: unknown };
      if ((entry.role !== "user" && entry.role !== "assistant") || typeof entry.text !== "string") return [];
      return [{ role: entry.role, content: entry.text.slice(0, 500) }];
    }) : [];

    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: Deno.env.get("OPENAI_MODEL") ?? "gpt-6-astra",
        instructions: `Você é o assistente de categorização do GestorPro. Ajude a classificar descrições de transações pessoais em português do Brasil. Não dê aconselhamento de investimento ou crédito, não invente detalhes ausentes e não peça senhas, números completos de conta, cartão ou códigos. Categorize como despesa, renda, transferência entre contas próprias ou incerto. Transferência entre contas da própria pessoa não é renda nem despesa. Se a descrição não deixar claro se é transferência própria ou pagamento a outra pessoa, explique a dúvida e não trate como transferência interna. Use categorias curtas como Alimentação, Moradia, Transporte, Saúde, Contas, Assinaturas, Salário, Renda extra, Transferências e Outros. Responda de forma breve, gentil e prática. A categoria é uma sugestão; a pessoa confirma antes de registrar.`,
        input: [...history, { role: "user", content: message }],
        max_output_tokens: 350,
        text: { format: {
          type: "json_schema",
          name: "gestorpro_transaction_category",
          strict: true,
          schema: {
            type: "object",
            additionalProperties: false,
            properties: {
              reply: { type: "string" },
              category: { type: "string" },
              transaction_type: { type: "string", enum: ["expense", "income", "transfer", "uncertain"] },
              explanation: { type: "string" },
              confidence: { type: "string", enum: ["high", "medium", "low"] },
            },
            required: ["reply", "category", "transaction_type", "explanation", "confidence"],
          },
        } },
      }),
    });

    if (!response.ok) {
      console.error("OpenAI request failed with status", response.status);
      return json({ error: "Não consegui analisar agora. Tente novamente em instantes." }, 502, headers);
    }
    const result = await response.json();
    const outputText = result.output_text ?? (Array.isArray(result.output)
      ? result.output.flatMap((item: { content?: Array<{ type?: string; text?: string }> }) =>
        (item.content ?? []).filter((part) => part.type === "output_text").map((part) => part.text ?? ""))
        .join("")
      : "");
    if (typeof outputText !== "string" || !outputText.trim()) {
      return json({ error: "A IA não retornou uma sugestão. Tente reformular a descrição." }, 502, headers);
    }
    const suggestion = JSON.parse(outputText);
    return json(suggestion, 200, headers);
  } catch (error) {
    console.error("Categorization function error", error instanceof Error ? error.message : "Unknown error");
    return json({ error: "Não consegui processar essa descrição. Tente novamente." }, 500, headers);
  }
});
