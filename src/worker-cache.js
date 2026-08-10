// worker.js — proxy do Assistente de IA do simulador ROMI D800
// Protege sua API key da Anthropic (nunca fica no código do
// navegador) e faz CACHE de perguntas frequentes usando
// Cloudflare KV — perguntas repetidas respondem na hora, sem
// gastar tokens da API nem esperar a resposta do Claude.
//
// Deploy e configuração do KV: veja o tutorial no README.md,
// seção "Cache de perguntas frequentes".

const CACHE_TTL_SEGUNDOS = 60 * 60 * 24 * 30; // 30 dias

export default {
  async fetch(request, env) {
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

    const chaveCache = await gerarChaveCache(message);

    // 1) tenta responder do cache primeiro (instantâneo, grátis)
    if (env.CACHE_PERGUNTAS) {
      try {
        const emCache = await env.CACHE_PERGUNTAS.get(chaveCache);
        if (emCache) {
          return new Response(emCache, {
            headers: { ...corsHeaders(), "x-cache": "HIT" }
          });
        }
      } catch (err) {
        console.warn("Erro ao ler cache (seguindo sem cache):", err.message);
      }
    }

    // 2) sem cache — consulta a API da Anthropic normalmente
    try {
      const anthropicResponse = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "x-api-key": env.ANTHROPIC_API_KEY,
          "anthropic-version": "2023-06-01",
          "content-type": "application/json"
        },
        body: JSON.stringify({
          model: "claude-haiku-4-5-20251001",
          max_tokens: 300,
          system: context || "",
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

      const respostaJson = JSON.stringify(data);

      // 3) guarda no cache pra próxima vez (não bloqueia a resposta ao usuário)
      if (env.CACHE_PERGUNTAS) {
        env.CACHE_PERGUNTAS
          .put(chaveCache, respostaJson, { expirationTtl: CACHE_TTL_SEGUNDOS })
          .catch((err) => console.warn("Erro ao salvar no cache:", err.message));
      }

      return new Response(respostaJson, {
        headers: { ...corsHeaders(), "x-cache": "MISS" }
      });
    } catch (err) {
      return new Response(JSON.stringify({ error: err.message || "Erro no proxy" }), {
        status: 500,
        headers: corsHeaders()
      });
    }
  }
};

// normaliza a pergunta (minúsculas, sem acento, sem espaços extras)
// e gera um hash — assim "Para que serve o SPINDLE?" e
// "para que serve o spindle" batem no MESMO cache
async function gerarChaveCache(texto) {
  const normalizado = texto
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // remove acentos
    .replace(/[^\w\s]/g, "") // remove pontuação
    .trim()
    .replace(/\s+/g, " ");

  const encoder = new TextEncoder();
  const dados = encoder.encode(normalizado);
  const hashBuffer = await crypto.subtle.digest("SHA-256", dados);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return "pergunta:" + hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "content-type",
    "content-type": "application/json"
  };
}
