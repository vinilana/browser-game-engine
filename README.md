# Aether Engine + VoxelCraft + Reinos

**Aether** é uma engine 3D para jogos de mundo aberto que rodam no navegador, com foco em
renderização realista. Ela usa **three.js** apenas como camada fina sobre o WebGL2 (buffers,
texturas, programas) e implementa por cima um **pipeline deferred HDR próprio**.

**VoxelCraft** é o jogo de teste: um "Minecraft ultra-realista" construído 100% sobre a engine.
**Reinos** é um RTS no estilo *Age of Empires* feito sobre a mesma engine e o mesmo pipeline.
Nenhum dos dois usa assets externos: texturas PBR, terreno, céu, modelos, sons e animais são
gerados proceduralmente em tempo de execução.

```bash
npm install
npm run dev        # http://localhost:5173  (VoxelCraft)
                   # http://localhost:5173/rts.html       (Reinos — RTS)
                   # http://localhost:5173/sandbox.html   (exemplo da engine sem voxels)
                   # http://localhost:5173/textures.html  (laboratório de texturas procedurais)
npm run build      # build estático em dist/ (pode ser servido por qualquer servidor HTTP)
```

Requisitos: navegador com WebGL2 + `EXT_color_buffer_float` (Chrome, Edge, Firefox, Safari 16+).
Uma GPU dedicada é recomendada; em GPUs integradas use o preset **Baixa** ou **Média**.

---

## Recursos da engine

### Renderização (`src/engine/render`)
| Recurso | Implementação |
|---|---|
| Pipeline deferred HDR | G-buffer MRT (albedo+AO, normal octaédrica+rugosidade+metal, luz do céu/bloco/emissivo/flags) + profundidade 32F |
| Céu físico | Atmosfera de Hillaire 2020: LUTs de transmitância, multi-scattering e sky-view (Rayleigh, Mie, ozônio). Sol, lua com crateras, estrelas cintilantes e Via Láctea |
| Nuvens volumétricas | Raymarching com ruído 3D Perlin-Worley (gerado num worker), aproximação de espalhamento múltiplo, "powder effect", sombras de nuvem no chão |
| Iluminação ambiente | Mapa de ambiente equiretangular (céu + nuvens) re-renderizado todo frame → projeção em harmônicos esféricos L2 (irradiância) + reflexos especulares por rugosidade |
| Sombras | Cascaded Shadow Maps estáveis (esfera envolvente + snap de texel), atlas 2×2, PCF por Poisson rotacionado com hardware compare, blend entre cascatas |
| Materiais | PBR GGX / Smith correlacionado / Schlick, BRDF de ambiente analítica, translucidez (SSS) para folhagem, emissivos |
| SSAO | Hemisfério orientado pela normal, meia resolução, blur bilateral |
| Luz volumétrica | Raymarching no shadow map (god rays), neblina de altura, modo subaquático com absorção |
| Água | Refração com absorção física (Beer-Lambert), SSR (reflexo em espaço de tela), fallback para o mapa de ambiente, brilho do sol GGX, espuma na costa, cáusticas no fundo, janela de Snell vista de baixo |
| Neblina | Perspectiva aérea baseada na LUT do céu + neblina exponencial de altura + fade suave no horizonte |
| TAA | Jitter Halton, reprojeção por profundidade, clipping de variância em YCoCg, histórico Catmull-Rom |
| Pós | Bloom físico (downsample 13-tap + Karis, upsample tent), exposição automática com adaptação, efeito Purkinje noturno, ACES/AgX, nitidez adaptativa (CAS), vinheta, grão |
| Overlay 1ª pessoa | Cena separada (mãos/itens) renderizada após o TAA (sem ghosting) |

### Mundo (`src/engine/voxel`, `src/engine/terrain`)
* **Streaming infinito** de colunas 32×32×256 em volta do jogador, priorizando a direção da câmera.
* **Workers** (pool com fila de prioridade) para geração, iluminação, meshing e síntese de texturas.
* **Iluminação voxel** por flood-fill (luz do céu + luz de blocos) numa região com margem de 16
  blocos → luz exata entre colunas; **AO por vértice** + **luz suave** + correção de anisotropia.
* **Meshing** com culling de faces, folhas cutout dupla-face + **folhagem volumosa** (tufos que
  quebram a silhueta cúbica), plantas em cruz com variação, tochas, cactos, água com altura por
  nível de fluido; formato compacto de 20 bytes/vértice; upload à GPU com orçamento por frame.
* **Texturas PBR procedurais** (albedo sRGB, normal+altura, rugosidade/metal/AO/emissivo) em
  `DataArrayTexture` com mipmaps e anisotropia; **parallax occlusion mapping** a curta distância.
* **Horizonte distante (LOD)**: heightfield gerado pelo mesmo gerador do mundo até ~2–3 km,
  com máscara de cobertura por coluna (sem buracos durante o streaming).
* **Física AABB** contra voxels (passos, agachar na borda, líquidos) e **raycast DDA**.
* **Variação macro em espaço de mundo** no shader do terreno para esconder a repetição das texturas.

### Outros sistemas
* `fx/ParticleSystem` — partículas instanciadas com colisão, iluminação do mundo e partículas suaves.
* `fx/Weather` — chuva por GPU com oclusão por heightmap, superfícies molhadas (poças), relâmpagos.
* `audio/AudioEngine` — áudio 100% sintetizado: passos por material, quebra/colocação, vento,
  pássaros de dia, grilos à noite, água, chuva, trovões, cavernas com reverb, abafamento subaquático.
* `core/*` — loop, input com pointer lock e duplo toque, configurações com presets persistidos.
* `render/materials/convert.js` — converte materiais padrão do three (ex.: modelos **GLTF**) para o
  pipeline deferred; `GBufferMaterial` suporta skinning, morph targets e instancing.

---

## VoxelCraft (o jogo de teste)

* Geração de terreno com continentalidade, erosão, picos/vales, **rios**, praias, e montanhas com
  **overhangs 3D**; biomas: planície, floresta, bétulas, taiga, tundra nevada, deserto, montanhas,
  oceano e oceano congelado, com **cor de grama/folhagem contínua por bioma**.
* Cavernas (túneis "spaghetti" + cavernas "cheese"), lagos de lava, minérios (carvão, ferro,
  ouro, diamante, esmeralda) e bolsões de granito/diorito/andesito.
* Árvores (carvalho, carvalho grande com galhos, bétula, pinheiro, pinheiro alto), grama alta,
  samambaias, flores, cana-de-açúcar, cactos, arbustos secos, abóboras.
* Ciclo dia/noite, chuva/tempestade, vagalumes, folhas caindo, fumaça e chama das tochas.
* Animais passivos (porco, vaca, ovelha, galinha) com IA simples e física.
* Modo criativo: ~60 blocos, inventório (E), barra rápida, quebrar/colocar/copiar bloco,
  mão em 1ª pessoa com animação, luz dinâmica ao segurar tocha/pedra luminosa.
* **Água que escoa** como no Minecraft (espalha até 7 blocos, cai em cascata e seca quando a
  fonte é removida); dá para colocar fontes de água e lava pelo inventário.
* Mundo salvo automaticamente no **IndexedDB** (edições, posição, hora, barra rápida) por semente.

### Controles
| Tecla | Ação |
|---|---|
| W A S D / mouse | mover / olhar |
| Espaço | pular / nadar |
| Espaço 2× ou F | voar |
| Shift | agachar / descer voando |
| Ctrl ou W 2× | correr |
| Clique esquerdo / direito / meio | quebrar / colocar / copiar bloco |
| 1–9, roda do mouse | selecionar bloco |
| E | inventário criativo |
| T | acelerar o tempo (60×) |
| R | liga/desliga chuva |
| F1 / F2 / F3 | esconder HUD / screenshot / depuração |
| Esc | pausa e configurações |

Parâmetros de URL úteis: `?seed=123`, `?quality=low|medium|high|ultra`, `?fresh` (ignora o save),
`?t=18` (hora inicial), `?tex=64|128|256` (resolução das texturas).

### Desempenho medido
RTX 4060 (via WSL2/D3D12), 1920×1080, FPS sem limite, com horizonte distante ligado:

| Preset | Resolução interna | Texturas | Frame | FPS |
|---|---|---|---|---|
| Baixa | 1152×648 | 64 px | ~6,3 ms | ~160 |
| Média | 1536×864 | 128 px | ~7,2 ms | ~140 |
| Alta | 1920×1080 | 128 px | ~9,6 ms | ~105 |
| Ultra | 1920×1080 | 256 px | ~11,2 ms | ~90 |

Carregamento inicial: ~3 s (Alta) / ~6 s (Ultra) até o mundo em volta do jogador estar pronto.

---

## Reinos (RTS estilo Age of Empires)

Partida 1×1 contra a IA num mapa de 288×288 m gerado por semente (florestas, colinas,
afloramentos de rocha, lagos, frutas silvestres, ouro, pedra, ovelhas e cervos).

* **Economia**: aldeões (homens e mulheres) cortam árvores (a árvore cai ao primeiro golpe e
  vira um tronco caído), colhem frutas, caçam, mineram ouro/pedra, cultivam fazendas e levam
  os recursos ao Centro da Cidade ou ao depósito mais próximo (serraria, moinho, mineração).
* **Construções**: Centro da Cidade, casa, serraria, moinho (pás giratórias), acampamento de
  mineração, fazenda (trigo cresce e é colhido), quartel, campo de arco e flecha, estábulo e
  torre de vigia. Obras sobem com **andaime** e plano de corte animado; construções danificadas
  soltam fumaça/fogo e desmoronam com poeira.
* **Exército**: milícia, lanceiro (bônus contra cavalaria), arqueiro (projéteis balísticos que
  ficam cravados no chão), cavalaria batedora e cavaleiro. Centro da Cidade e torres atiram flechas.
* **Três eras** (Trevas → Feudal → Castelos) que liberam construções e unidades.
* **Névoa de guerra** (não explorado / memória / visível) integrada à iluminação do pipeline,
  minimapa com névoa e retângulo da câmera, vitória/derrota com estatísticas.
* **IA** com três dificuldades: gerencia economia (aldeões, casas, depósitos, fazendas),
  guarda recursos para subir de era, treina exército misto, defende a base e ataca em ondas.
* **Visual**: terreno heightfield com 8 camadas PBR misturadas por altura, grama instanciada,
  árvores instanciadas (carvalho/pinheiro/arbusto) com vento, água com refração/SSR, sombras
  em cascata, SSAO, TAA, céu e nuvens volumétricas da engine; personagens animados por GPU com
  cor do time; horizonte além da borda do mapa com copas de floresta procedurais.
* **Som** procedural: machado, picareta, martelo, espadas, arcos, queda de árvores, sino,
  trompas de alerta, ambiente que acompanha a câmera.

### Interação contextual (botão direito)
O cursor e uma dica ao lado dele mostram, antes do clique, o que o botão direito vai fazer com a
seleção atual sobre aquilo que está sob o mouse (contorno tracejado na cor da ação):

| Alvo | Aldeões | Soldados |
|---|---|---|
| Cervo | **caçar**: arremessa a lança (o cervo foge ao ser atingido e é perseguido) | abater |
| Ovelha | **abater** com a lança | andar até ela (reúne o rebanho) |
| Carcaça | **esquartejar** (só apodrece se ficar abandonada) | mover |
| Árvore | **derrubar e cortar**: alguns golpes, a árvore balança, cai longe do lenhador e é cortada no tronco (cada lenhador pega uma vaga livre ao longo dele) | mover |
| Ouro / pedra / frutas | **minerar / extrair / colher** | mover |
| Fazenda | **cultivar** (um lavrador por campo; os outros procuram campos livres) | mover |
| Fundação / prédio danificado | **construir / reparar** (reparo custa 50% do preço, pago aos poucos) | mover |
| Depósito carregando recursos | **depositar** e voltar ao mesmo trabalho | mover |
| Unidade ou prédio inimigo | atacar | **atacar** |
| (prédio de treino selecionado) | **ponto de encontro**; num recurso, os novos aldeões já vão trabalhar | — |

* **Seleção precisa**: cápsulas projetadas para unidades, raio × malha para prédios (o que está
  atrás de uma parede não é pego), copa e tronco caído para árvores.
* **Golpes sincronizados com a animação**: machadadas soltam lascas e folhas, a picareta faz faíscas
  no ouro, o martelo levanta pó; espadas e lanças acertam no instante do impacto (e erram se o alvo
  saiu do alcance); flechas e lanças saem da mão no momento certo.
* **Retorno visual e sonoro**: o alvo da ordem pisca, bandeiras marcam o destino, linhas tracejadas
  mostram a rota e as ordens na fila, "+10 madeira" sobe ao depositar, e cada verbo tem sua
  confirmação sonora.
* **Fila com Shift** (mover, construir, atacar...) e prédios em série com Shift ao posicionar.
* **Soldados**: ataque em movimento (Q) e posturas agressiva / defensiva / manter posição (A/S/D);
  perseguição em linha reta quando o caminho está livre.
* **Ovelhas pastoreáveis**: passam para quem chegar perto, podem ser levadas ao Centro da Cidade e
  roubadas se ficarem sem guarda. **Fazendas** esgotadas são replantadas automaticamente (60 de madeira).
* O painel mostra o que cada aldeão está fazendo ("Derrubando uma árvore", "Esquartejando a caça"...)
  e a barra do que ele carrega.

### Controles (Reinos)
| Entrada | Ação |
|---|---|
| Clique esquerdo / arrastar | selecionar / seleção em caixa (Shift adiciona) |
| Duplo clique ou Ctrl + clique | seleciona todas as unidades do mesmo tipo na tela |
| Clique direito | ação contextual (veja a tabela acima); Shift + clique direito enfileira |
| Q W E R T · A S D F G · Z X C V B | atalhos da grade de comandos (construir, treinar, parar, excluir) |
| Shift ao posicionar | continua posicionando o mesmo edifício (os aldeões constroem em sequência) |
| Q · A / S / D (soldados) | ataque em movimento · posturas agressiva / defensiva / manter posição |
| Ctrl + 0–9 / 0–9 | define / seleciona grupo (2× centraliza a câmera) |
| H | seleciona o Centro da Cidade · `.` próximo aldeão ocioso · Espaço centraliza a seleção |
| Del | exclui a seleção |
| Setas / bordas da tela | mover a câmera · roda do mouse: zoom |
| PgUp / PgDn / botão do meio | girar a câmera |
| Esc | cancela posicionamento → limpa seleção → pausa · F10 menu |

Parâmetros de URL: `rts.html?autostart&seed=42&difficulty=easy|normal|hard&quality=low|medium|high|ultra`
e `&reveal` (revela o mapa, para depuração).

Desempenho medido (RTX 4060 via WSL2, 1920×1080, preset Alta, ~85 unidades e ~50 construções
após 30 min de partida simulada): ~6–8 ms por frame (~125 FPS), ~500–950 draw calls.

### Adições à engine feitas para o RTS
* `ai/Pathfinder.lineFree` — teste de linha livre usado na perseguição direta.
* `camera/RTSCamera` — câmera orbital de estratégia (pan por bordas/setas, zoom com pitch
  progressivo, rotação, limites, seguir o terreno).
* `terrain/Heightfield` + `terrain/TerrainRenderer` — terreno por heightfield com splatting de
  8 camadas misturadas por altura, pintura em tempo real (`paint`, `paintRect`), achatamento de
  terreno para construções, raycast e pedaços com sombras.
* `render/materials/WaterMaterial` — água genérica (lagos) usando o mesmo shader físico.
* `ai/Pathfinder` — A* em grade com ocupação dinâmica (contadores), suavização por linha de visão
  e busca da célula livre mais próxima.
* `geometry/MeshBuilder` — construtor de malhas procedurais (caixas, cilindros, cones, esferas,
  telhados de duas águas, pirâmides) com atributos extras, usado por prédios, árvores e unidades.
* `procedural/painters` — pintores de texturas PBR reutilizáveis (grama, solo, rocha, alvenaria,
  reboco, tábuas, telhas, sapê, tecido, cascas, folhas, tufos de grama...).
* `RenderPipeline.setWorldMask` — máscara de mundo (névoa de guerra) aplicada na iluminação.
* `GBufferMaterial` — mapas de albedo/normal/material, escala de UV, vento, plano de corte em Y
  (obras), flags de folhagem, cobertura alfa com mip limitado (`alphaMaxLod`) e material de
  sombra compatível automático.
* `FarTerrain` — LODs configuráveis, retângulo de exclusão e canal de floresta (copas procedurais).
* `ShadowCascades.start`, `Input` com cursor livre (sem pointer lock) e `Settings` com chave própria.

---

## Usando a engine no seu jogo

```js
import { Engine } from './src/engine/core/Engine.js';
import { GBufferMaterial } from './src/engine/render/materials/GBufferMaterial.js';
import { Mesh, SphereGeometry, Color } from 'three';

const engine = new Engine({ canvas: document.querySelector('canvas') });
engine.atmosphere.hours = 17.5;              // hora do dia (ciclo automático)
engine.atmosphere.rain = 0;                  // clima 0..1

const ball = new Mesh(new SphereGeometry(1, 64, 32),
  new GBufferMaterial({ color: new Color(1, 0.77, 0.34), metalness: 1, roughness: 0.25 }));
engine.scene.add(ball);                      // objetos opacos → pipeline deferred
engine.pipeline.addShadowCaster(ball);       // projeta sombra

engine.addSystem({ update(dt) { ball.rotation.y += dt; } });
engine.start();
```

* `engine.scene` — objetos opacos (precisam de material G-buffer: `GBufferMaterial` ou shaders
  que escrevam os 3 alvos MRT).
* `engine.forwardScene` — transparentes/efeitos com shading forward (podem ler `tSceneColor` e
  `tSceneDepth` para refração).
* `engine.pipeline.overlayScene` — itens em 1ª pessoa.
* `engine.pipeline.params` — neblina, bloom, exposição, luz de blocos, tonemapper etc.
* `engine.settings` — presets de qualidade (`applyPreset('ultra')`), persistidos no localStorage.

Para um mundo voxel, veja `src/game/`: o jogo registra blocos (`blocks.js`), receitas de textura
(`textures.js`) e um gerador (`worldgen.js`) que roda dentro do worker (`world.worker.js`):

```js
// world.worker.js
import { startVoxelWorker } from '../engine/voxel/workerRuntime.js';
startVoxelWorker({ registry, createGenerator, textureRecipes });

// main thread
const world = new VoxelWorld({ pipeline: engine.pipeline, registry, seed,
  workerFactory: () => new Worker(new URL('./world.worker.js', import.meta.url), { type: 'module' }) });
await world.init();
engine.addSystem({ update: () => world.update(player.position, viewDir) });
```

Um gerador precisa implementar `generate(cx, cz) → { blocks, tints }` e, para o horizonte
distante, `farSample(x, z, out) → { h, r, g, b, water, forest? }`.

---

## Estrutura

```
src/engine/
  core/        Engine (loop), Input, Settings, WorkerPool, EventEmitter
  math/        ruído simplex/fbm/ridged, ruído tileável (Perlin/Worley), RNG determinístico
  render/      RenderPipeline, Atmosphere, ShadowCascades, FullscreenPass, cloudNoise.worker
    shaders/   common, atmosphere, sky(+nuvens), shadows, lighting(+neblina), post (SSAO, volumétrico, TAA, bloom, exposição, final)
    materials/ GBufferMaterial
  voxel/       BlockRegistry, VoxelWorld (streaming), Mesher (luz+malha), VoxelMaterials (terreno/água),
               VoxelPhysics, TextureSynth, workerRuntime
  terrain/     FarTerrain (LOD de horizonte), farTileBuilder, Heightfield, TerrainRenderer
  camera/      RTSCamera
  ai/          Pathfinder (A* em grade)
  geometry/    MeshBuilder
  procedural/  painters (texturas PBR reutilizáveis)
  fx/          ParticleSystem, Weather
  audio/       AudioEngine
src/game/      VoxelCraft: main, blocks, textures, worldgen, Player, Interaction, Hand, ui, icons, ambience, mobs, storage
src/rts/       Reinos: main, config, mapgen, world, vegetation, entities, game (simulação), ai, render,
               controls (seleção e ações contextuais), cursors, ui, icons, audio, assets, textures,
               rts.worker, models/ (prédios, árvores, unidades)
src/sandbox/   exemplo mínimo da engine sem voxels
src/tools/     laboratório de texturas
```

## Limitações conhecidas / próximos passos
* Reinos: sem pesquisas/tecnologias, muralhas, navios ou multiplayer; uma civilização só.
* Blocos não têm estados (orientação, meia-laje, escadas); lava não escoa.
* Sem multiplayer, sem modo sobrevivência (vida/fome/crafting).
* SSR só reflete o que está na tela; fora dela usa o mapa de ambiente.
* O LOD distante é um heightfield (sem cavernas/overhangs à distância).
