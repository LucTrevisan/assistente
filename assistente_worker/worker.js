// worker.js — proxy do Assistente de IA do simulador ROMI D800
// Protege sua API key da Anthropic, que nunca deve ficar no
// código do Babylon.js (que roda no navegador do usuário).
//
// Deploy: veja o tutorial no README.md, seção "Assistente de IA".

export default {
  async fetch(request, env) {
    // responde o preflight do navegador (CORS)
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders() });
    }

    if (request.method !== "POST") {
      return new Response("Method not allowed", { status: 405, headers: corsHeaders() });
    }

    let body;
    try {
      body = await request.json();
    } catch {
      return new Response(JSON.stringify({ error: "JSON inválido" }), {
        status: 400,
        headers: corsHeaders()
      });
    }

    const { message, context } = body;
    if (!message || typeof message !== "string") {
      return new Response(JSON.stringify({ error: "Campo 'message' é obrigatório" }), {
        status: 400,
        headers: corsHeaders()
      });
    }

    try {
      const anthropicResponse = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "x-api-key": env.ANTHROPIC_API_KEY, // configurado como Secret no Worker
          "anthropic-version": "2023-06-01",
          "content-type": "application/json"
        },
   body: JSON.stringify({
  model: "claude-haiku-4-5-20251001",
  max_tokens: 300,
  system: "Você é um assistente técnico em português brasileiro. Responda SEMPRE em português, nunca em inglês ou outra língua. " + (context || ""),
  messages: [{ role: "user", content: message }]
})
      });

      const data = await anthropicResponse.json();

      if (!anthropicResponse.ok) {
        return new Response(JSON.stringify({ error: data }), {
          status: anthropicResponse.status,
          headers: corsHeaders()
        });
      }

      return new Response(JSON.stringify(data), { headers: corsHeaders() });
    } catch (err) {
      return new Response(JSON.stringify({ error: err.message || "Erro no proxy" }), {
        status: 500,
        headers: corsHeaders()
      });
    }
  }
};

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*", // pode restringir ao domínio do GitHub Pages depois
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "content-type",
    "content-type": "application/json"
  };
}
