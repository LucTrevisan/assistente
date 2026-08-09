import {
  Engine,
  Scene,
  ArcRotateCamera,
  HemisphericLight,
  DirectionalLight,
  Vector3,
  Color3,
  Color4,
  SceneLoader,
  MeshBuilder,
  StandardMaterial,
  ShadowGenerator,
  CubicEase,
  EasingFunction,
  WebXRFeatureName
} from "@babylonjs/core";
import "@babylonjs/loaders/glTF";

// =========================================================
// CONFIGURAÇÃO — ajuste conforme necessário
// =========================================================
const CONFIG = {
  modelMaquina: "maquina.glb",
  modelRobo: "biped_robot.glb",
  modelPath: "models/",
  distanciaExplosaoPadrao: 1.4,
  pecasPequenasKeywords: ["parafuso", "porca", "arruela", "pino"],
  multiplicadorPecaPequena: 2.2,
  correcaoRotacao: { x: -Math.PI / 2, y: 0, z: 0 },
  // URL do proxy Cloudflare Workers (assistente de IA)
  assistantProxyUrl: "https://assistente-worker.luctrevisan.workers.dev/",
  // contexto que o assistente recebe (sobre a máquina)
  assistantContexto:
    "Você é um assistente técnico do simulador ROMI D1250 (centro de usinagem CNC vertical, 3 eixos) " +
    "usado no laboratório de Mecatrônica do SENAI Adolpho Lobbe, São Carlos/SP. " +
    "Peças do modelo: BASE_AXIS, X_AXIS, Y_AXIS, Z_AXIS, SPINDLE, TOOLMAGAZINE, POCKET_TC, TOOL_CHANGER, " +
    "CONVEYOR, ENCLOSURE, DOOR_LEFT, DOOR_RIGHT. Responda em português, de forma curta e didática " +
    "(máximo 3-4 frases), pensando em alunos técnicos iniciantes.",
  // voz em português
  idiomaVoz: "pt-BR"
};

// =========================================================
// SETUP BÁSICO DA CENA
// =========================================================
const canvas = document.getElementById("renderCanvas");
const engine = new Engine(canvas, true, { stencil: true, antialias: true });
const scene = new Scene();
scene.clearColor = new Color4(0.13, 0.14, 0.17, 1);

let containerMaquina;
let robo;
let meshBoca; // mesh que será animada como "boca"
let dadosExplosao = [];
let dir; // luz direcional (usada pra sombras)

// =========================================================
// CARREGAMENTO PRINCIPAL
// =========================================================
window.addEventListener("DOMContentLoaded", async () => {
  try {
    configurarCameraIluminacao();
    
    // carrega os modelos
    await carregarMaquina();
    await carregarRobo();
    
    // começa o loop de renderização
    engine.runRenderLoop(() => scene.render());
    
    // redimensiona a janela
    window.addEventListener("resize", () => engine.resize());
  } catch (err) {
    console.error("Erro ao inicializar:", err);
  }
});

function configurarCameraIluminacao() {
  const camera = new ArcRotateCamera(
    "camera",
    Math.PI / 2,
    Math.PI / 2.5,
    50,
    Vector3.Zero(),
    scene
  );
  camera.attachControl(canvas, true);
  camera.wheelPrecision = 50;
  camera.speed = 5;

  const hemi = new HemisphericLight("hemi", new Vector3(0, 1, 0.5), scene);
  hemi.intensity = 1.2;

  dir = new DirectionalLight("dir", new Vector3(-0.5, -1, -0.5), scene);
  dir.intensity = 1.0;
  dir.position = new Vector3(20, 30, 20);

  const fill = new DirectionalLight("fill", new Vector3(0.5, 0.3, 0.5), scene);
  fill.intensity = 0.5;

  scene.imageProcessingConfiguration.exposure = 1.1;
}

async function carregarMaquina() {
  try {
    const result = await SceneLoader.ImportMeshAsync(
      "",
      CONFIG.modelPath,
      CONFIG.modelMaquina,
      scene
    );

    const partes = result.meshes.filter((m) => m.getTotalVertices && m.getTotalVertices() > 0);
    
    containerMaquina = MeshBuilder.CreateBox("containerMaquina", { size: 0.1 }, scene);
    containerMaquina.isVisible = false;
    partes.forEach((m) => m.setParent(containerMaquina));

    containerMaquina.rotation.set(
      CONFIG.correcaoRotacao.x,
      CONFIG.correcaoRotacao.y,
      CONFIG.correcaoRotacao.z
    );
    containerMaquina.computeWorldMatrix(true);

    let bbox = calcularBoundingBox(partes);
    containerMaquina.position.y -= bbox.min.y;
    scene.incrementRenderId();
    containerMaquina.computeWorldMatrix(true);
    partes.forEach((p) => p.computeWorldMatrix(true));

    const shadowGenerator = new ShadowGenerator(2048, dir);
    partes.forEach((mesh) => {
      shadowGenerator.addShadowCaster(mesh);
      mesh.receiveShadows = true;
    });

    bbox = calcularBoundingBox(partes);
    construirCenario(bbox);
    enquadrarCamera(bbox);
    aplicarAcabamentoPolido(partes);
    criarPlacaRomiD800(bbox);

    dadosExplosao = prepararExplosao(partes);
    prepararModoLivre(partes);

    console.log(`✅ Máquina carregada: ${partes.length} peças`);
  } catch (err) {
    console.error("Erro ao carregar máquina:", err);
  }
}

async function carregarRobo() {
  try {
    const result = await SceneLoader.ImportMeshAsync(
      "",
      CONFIG.modelPath,
      CONFIG.modelRobo,
      scene
    );

    robo = result.meshes[0];
    console.log("📋 Estrutura do robô:", result.meshes.map(m => m.name));

    // tenta achar a boca automaticamente (procura por keywords)
    meshBoca = result.meshes.find(m =>
      /mouth|jaw|boca|beak|face|head/i.test(m.name)
    );

    if (!meshBoca) {
      // fallback: usa a cabeça ou primeira mesh disponível
      meshBoca = result.meshes.find(m => /head|cabeca|rosto/i.test(m.name)) || result.meshes[1];
      console.warn("⚠️ Boca não encontrada, usando fallback:", meshBoca?.name);
    } else {
      console.log("✅ Boca encontrada:", meshBoca.name);
    }

    // posiciona ao lado da máquina
    const bbox = calcularBoundingBox([containerMaquina]);
    robo.position = new Vector3(
      bbox.centro.x + bbox.tamanho.x * 0.8,
      bbox.tamanho.y * 0.3,
      bbox.centro.z + bbox.tamanho.z * 0.5
    );

    // escalinha
    const fator = Math.max(bbox.tamanho.y / 12, 0.5);
    robo.scaling.setAll(fator);

    // sombra
    const shadowGenerator = new ShadowGenerator(2048, dir);
    result.meshes.forEach(m => {
      if (m.getTotalVertices && m.getTotalVertices() > 0) {
        shadowGenerator.addShadowCaster(m);
        m.receiveShadows = true;
      }
    });

    console.log("✅ Robô carregado e posicionado");
    console.log("🎤 Diga algo pra começar... (o robô está ouvindo)");

    // começa a escutar automaticamente
    iniciarEscuta();
  } catch (err) {
    console.error("Erro ao carregar robô:", err);
  }
}

// =========================================================
// ESCUTA POR VOZ — Web Speech API (grátis)
// =========================================================
let escutandoAgora = false;
let reconhecimento;
let podeReiniciarEscuta = true;

function iniciarEscuta() {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  
  if (!SpeechRecognition) {
    console.error("❌ Web Speech API não é suportado neste navegador");
    return;
  }

  reconhecimento = new SpeechRecognition();
  reconhecimento.lang = CONFIG.idiomaVoz;
  reconhecimento.interimResults = false;
  reconhecimento.maxAlternatives = 1;
  reconhecimento.continuous = false;

  reconhecimento.onstart = () => {
    escutandoAgora = true;
    console.log("🎤 Ouvindo...");
    animarRoboOuvindo();
  };

  reconhecimento.onresult = (event) => {
    const pergunta = event.results[0][0].transcript;
    console.log("📢 Você disse:", pergunta);
    processarPergunta(pergunta);
  };

  reconhecimento.onerror = (event) => {
    console.warn("❌ Erro de voz:", event.error);
    escutandoAgora = false;
  };

  reconhecimento.onend = () => {
    escutandoAgora = false;
    console.log("🤐 Parou de ouvir, reiniciando em 2s...");
    // reinicia a escuta depois de um tempo, mas APENAS se não estiver já rodando
    podeReiniciarEscuta = true;
    setTimeout(() => {
      if (podeReiniciarEscuta && reconhecimento && !escutandoAgora) {
        try {
          reconhecimento.start();
        } catch (err) {
          console.warn("Não conseguiu reiniciar escuta:", err.message);
        }
      }
    }, 2000);
  };

  // começa a escuta
  try {
    reconhecimento.start();
  } catch (err) {
    console.error("Erro ao iniciar escuta:", err.message);
  }
}

// =========================================================
// PROCESSAR PERGUNTA — enviar pro assistente
// =========================================================
async function processarPergunta(pergunta) {
  if (!CONFIG.assistantProxyUrl.includes("workers.dev")) {
    console.error("❌ URL do proxy não configurada");
    return;
  }

  try {
    console.log("💭 Enviando pergunta pro assistente...");
    
    const resp = await fetch(CONFIG.assistantProxyUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        message: pergunta,
        context: "Você é um assistente técnico em português brasileiro. Responda SEMPRE em português. " + CONFIG.assistantContexto
      })
    });

    if (!resp.ok) throw new Error(`Proxy respondeu ${resp.status}`);
    
    const data = await resp.json();
    const resposta =
      data?.content?.find((bloco) => bloco.type === "text")?.text ||
      "Não consegui gerar uma resposta.";

    console.log("🤖 Resposta:", resposta);
    
    // fala a resposta
    fazerRoboFalar(resposta);
  } catch (err) {
    console.error("❌ Erro ao consultar assistente:", err.message);
  }
}

// =========================================================
// FAZER O ROBÔ FALAR — TTS nativo + animação de boca
// =========================================================
function fazerRoboFalar(texto) {
  if (!("speechSynthesis" in window)) {
    console.error("❌ Speech Synthesis não suportado");
    return;
  }

  const fala = new SpeechSynthesisUtterance(texto);
  fala.lang = CONFIG.idiomaVoz;
  fala.rate = 0.9;
  fala.pitch = 1.0;
  fala.volume = 1.0;

  // animação de boca enquanto fala
  fala.onstart = () => {
    console.log("🗣️ Falando...");
    animarBocaAbrindo();
  };

  fala.onend = () => {
    console.log("✅ Terminou de falar");
    animarBocaFechando();
    
    // volta a escutar depois de um tempo
    setTimeout(() => {
      if (reconhecimento && !escutandoAgora) {
        try {
          reconhecimento.start();
        } catch (err) {
          console.warn("Não conseguiu reiniciar escuta:", err.message);
        }
      }
    }, 1500);
  };

  fala.onerror = (e) => {
    console.warn("⚠️ Erro na síntese:", e.error);
  };

  window.speechSynthesis.cancel();
  window.speechSynthesis.speak(fala);
}

// =========================================================
// ANIMAÇÕES DO ROBÔ
// =========================================================
let animacaoAtiva = false;

function animarBocaAbrindo() {
  if (!meshBoca) return;
  animacaoAtiva = true;
  
  const escalOriginal = meshBoca.scaling.y;
  const velocidade = 0.1;
  
  const intervalo = setInterval(() => {
    if (meshBoca.scaling.y < 1.3) {
      meshBoca.scaling.y += velocidade;
    } else {
      clearInterval(intervalo);
    }
  }, 30);
}

function animarBocaFechando() {
  if (!meshBoca) return;
  
  const velocidade = 0.08;
  
  const intervalo = setInterval(() => {
    if (meshBoca.scaling.y > 1.0) {
      meshBoca.scaling.y -= velocidade;
    } else {
      meshBoca.scaling.y = 1.0;
      animacaoAtiva = false;
      clearInterval(intervalo);
    }
  }, 30);
}

function animarRoboOuvindo() {
  if (!robo) return;
  // pisca os "olhos" (animação sutil na cabeça)
  robo.rotation.z += 0.05;
}

// =========================================================
// FUNÇÕES AUXILIARES (reutilizadas do projeto anterior)
// =========================================================
function calcularBoundingBox(meshes) {
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;

  meshes.forEach((mesh) => {
    if (!mesh.getAbsolutePosition) return;
    const pos = mesh.getAbsolutePosition();
    const bbox = mesh.getBoundingInfo().boundingBox;
    
    if (bbox) {
      minX = Math.min(minX, pos.x + bbox.minimumWorld.x);
      minY = Math.min(minY, pos.y + bbox.minimumWorld.y);
      minZ = Math.min(minZ, pos.z + bbox.minimumWorld.z);
      maxX = Math.max(maxX, pos.x + bbox.maximumWorld.x);
      maxY = Math.max(maxY, pos.y + bbox.maximumWorld.y);
      maxZ = Math.max(maxZ, pos.z + bbox.maximumWorld.z);
    }
  });

  return {
    min: new Vector3(minX === Infinity ? 0 : minX, minY === Infinity ? 0 : minY, minZ === Infinity ? 0 : minZ),
    max: new Vector3(maxX === -Infinity ? 0 : maxX, maxY === -Infinity ? 0 : maxY, maxZ === -Infinity ? 0 : maxZ),
    centro: new Vector3(
      (minX + maxX) / 2 || 0,
      (minY + maxY) / 2 || 0,
      (minZ + maxZ) / 2 || 0
    ),
    tamanho: new Vector3(
      (maxX - minX) || 1,
      (maxY - minY) || 1,
      (maxZ - minZ) || 1
    )
  };
}

function enquadrarCamera(bbox) {
  const tamanho = bbox.tamanho.length();
  const camera = scene.activeCamera;
  camera.target = bbox.centro;
  camera.radius = tamanho * 2;
}

function construirCenario(bbox) {
  const tamanho = Math.max(bbox.tamanho.x, bbox.tamanho.z) * 2.5;
  
  const piso = MeshBuilder.CreateGround("piso", { width: tamanho * 2, height: tamanho * 2 }, scene);
  const matPiso = new StandardMaterial("matPiso", scene);
  matPiso.diffuse = new Color3(0.5, 0.5, 0.52);
  piso.material = matPiso;
  piso.receiveShadows = true;
}

function criarPlacaRomiD800(bbox) {
  // placa simples de identificação
  const placa = MeshBuilder.CreateBox("placa", { width: 0.8, height: 0.3, depth: 0.05 }, scene);
  placa.position.y = bbox.tamanho.y + 0.5;
  placa.position.z = bbox.centro.z - bbox.tamanho.z / 2 - 0.5;
  
  const matPlaca = new StandardMaterial("matPlaca", scene);
  matPlaca.diffuse = new Color3(0.2, 0.2, 0.25);
  placa.material = matPlaca;
}

function aplicarAcabamentoPolido(partes) {
  partes.forEach((mesh) => {
    if (!mesh.material) {
      const mat = new StandardMaterial("mat_" + mesh.name, scene);
      mat.specularColor = new Color3(0.4, 0.4, 0.4);
      mesh.material = mat;
    }
  });
}

function prepararExplosao(partes) {
  const centro = calcularBoundingBox(partes).centro;
  return partes.map((mesh) => {
    const posicaoOriginal = mesh.position.clone();
    const direcao = posicaoOriginal.subtract(centro).normalize();
    return { mesh, posicaoOriginal, direcao, distancia: 0 };
  });
}

function prepararModoLivre(partes) {
  partes.forEach((mesh) => {
    // permite arrastar peças manualmente (opcional)
    mesh.metadata = { draggable: true };
  });
}
