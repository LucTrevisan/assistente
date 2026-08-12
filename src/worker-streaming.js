// worker.js — proxy do Assistente de IA do simulador ROMI D800
// Protege sua API key da Anthropic (nunca fica no código do
// navegador), faz CACHE de perguntas frequentes (Cloudflare KV)
// e agora também faz STREAMING da resposta — o robô começa a
// falar a primeira frase assim que ela chega, sem esperar o
// texto inteiro. Reduz bastante a demora percebida.
//
// Deploy e configuração: veja o tutorial no README.md.

const CACHE_TTL_SEGUNDOS = 60 * 60 * 24 * 30; // 30 dias

export default {
  async fetch(request, env, ctx) {
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

    // 1) responde do cache instantaneamente, como texto puro
    // (sem streaming — não precisa, já é rápido)
    if (env.CACHE_PERGUNTAS) {
      try {
        const emCache = await env.CACHE_PERGUNTAS.get(chaveCache);
        if (emCache) {
          return new Response(JSON.stringify({ text: emCache, cached: true }), {
            headers: { ...corsHeaders(), "x-cache": "HIT", "content-type": "application/json" }
          });
        }
      } catch (err) {
        console.warn("Erro ao ler cache:", err.message);
      }
    }

    // 2) sem cache — consulta a Anthropic com streaming ativado
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
          messages: [{ role: "user", content: message }],
          stream: true
        })
      });

      if (!anthropicResponse.ok || !anthropicResponse.body) {
        const erro = await anthropicResponse.text();
        return new Response(JSON.stringify({ error: erro }), {
          status: anthropicResponse.status,
          headers: corsHeaders()
        });
      }

      // repassa o stream pro navegador E, em paralelo, acumula o
      // texto completo pra salvar no cache quando terminar
      let textoCompleto = "";
      const decoder = new TextDecoder();
      const encoder = new TextEncoder();

      const streamTransformado = new ReadableStream({
        async start(controller) {
          const reader = anthropicResponse.body.getReader();
          let bufferLinha = "";

          while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            bufferLinha += decoder.decode(value, { stream: true });
            const linhas = bufferLinha.split("\n");
            bufferLinha = linhas.pop(); // guarda linha incompleta pro próximo pedaço

            for (const linha of linhas) {
              if (!linha.startsWith("data: ")) continue;
              const dado = linha.slice(6);
              if (dado === "[DONE]") continue;

              try {
                const evento = JSON.parse(dado);
                if (evento.type === "content_block_delta" && evento.delta?.text) {
                  textoCompleto += evento.delta.text;
                  // manda só o pedacinho de texto novo pro cliente
                  controller.enqueue(encoder.encode(evento.delta.text));
                }
              } catch {
                // ignora linhas que não são JSON válido (comentários SSE, etc)
              }
            }
          }
          controller.close();

          // salva no cache depois que o streaming terminou (não
          // atrasa a resposta ao usuário)
          if (env.CACHE_PERGUNTAS && textoCompleto) {
            ctx.waitUntil(
              env.CACHE_PERGUNTAS.put(chaveCache, textoCompleto, {
                expirationTtl: CACHE_TTL_SEGUNDOS
              })
            );
          }
        }
      });

      return new Response(streamTransformado, {
        headers: { ...corsHeaders(), "x-cache": "MISS", "content-type": "text/plain; charset=utf-8" }
      });
    } catch (err) {
      return new Response(JSON.stringify({ error: err.message || "Erro no proxy" }), {
        status: 500,
        headers: corsHeaders()
      });
    }
  }
};

async function gerarChaveCache(texto) {
  const normalizado = texto
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\w\s]/g, "")
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
    "Access-Control-Allow-Headers": "content-type"
  };
}
