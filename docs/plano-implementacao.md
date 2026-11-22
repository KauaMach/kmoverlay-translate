# Plano de implementação

Plano para construir a extensão de tradução de imagens e texto descrita em [extensao-traducao.md](../extensao-traducao.md). Revisado em 22/11/2026, com as afirmações técnicas conferidas em fontes oficiais. O que ainda depende de teste está marcado com "(verificar)".

## Premissas

- **Escopo:** texto dentro das imagens (balões de HQ, mangá e webtoon) e texto comum das páginas, mantendo a formatação.
- **Idiomas de origem nas imagens:** inglês no MVP; depois japonês, coreano, chinês, espanhol e russo (Fase 5).
- **Conteúdo em inglês do MVP:** HQ, mangá traduzido (leitura da direita para a esquerda) e webtoon (tiras longas fatiadas em várias imagens).
- **Origem no texto da página:** qualquer idioma que o tradutor entenda.
- **Destino:** configurável. O padrão é português do Brasil, o único testado no início.
- **Uso:** pessoal. O repositório é público, sob GPL-3.0.
- **Navegadores:** Chrome e Firefox no PC; Firefox no Android.
- **Arquitetura:** extensão no navegador e servidor local em Python (opção A do estudo), com pipeline próprio.
- **MVP:** Fases 0 a 4 (inglês, imagens e texto da página, no PC).

### Hardware de referência

| Item | Valor |
|---|---|
| GPU | NVIDIA RTX 3050 Laptop, 6 GB de VRAM |
| RAM | 16 GB |
| Ferramentas | Python 3.15 (sistema), Node 22, `uv`, `npm`, `rsvg-convert`; Ollama não instalado |

## Ajustes em relação ao estudo

1. **Captura da imagem.** Ordem de tentativa:
   - Ler da própria página, pelo content script, quando a imagem é da mesma origem ou é `data:`. Imagens `blob:` também devem funcionar assim (verificar).
   - Baixar pelo background. Com `host_permissions`, o fetch do background não sofre bloqueio de CORS (confirmado). Sites que bloqueiam hotlink checam o `Referer`, que pode ser ajustado com `declarativeNetRequest` nas requisições da própria extensão (verificar).
   - Se nada funcionar, a imagem fica marcada como "sem suporte" até a Fase 8 (captura da aba). O `captureVisibleTab` do Chrome aceita no máximo 2 chamadas por segundo (confirmado).
2. **Só o background fala com o servidor.** Precisa de `host_permissions` com entrada `http://` própria para o servidor. O Local Network Access do Chrome 142+ não deve afetar extensões com a permissão certa, mas isso vem de fala da equipe do Chrome, não da documentação (verificar). Mixed content a partir do background também não é documentado (verificar).
3. **Cache.**
   - Chave: hashes dos bytes originais + JSON canônico das opções (origem, destino, direção de leitura, série, flags) + versão de cada etapa.
   - O servidor guarda cada etapa separada (detecção e OCR, tradução, renderização), para que mudar a renderização não exija rodar o LLM de novo.
   - IndexedDB (no background, origem da extensão) e disco têm teto de tamanho e descarte LRU.
   - Imagens sem texto também são cacheadas, para não serem reenviadas a cada rolagem.
   - O hash é calculado antes de qualquer recompressão (ex.: WebP no celular).
4. **Tradução.** Ollama e NLLB ficam os dois no projeto, como implementações da mesma interface (segmentos + contexto → segmentos), e o usuário escolhe qual usar nas opções da extensão. A Fase 0 define qual é o padrão. Candidatos:
   - LLM de 3 a 4B via Ollama, traduzindo a página inteira numa chamada, com saída validada por JSON schema (suportado desde a versão 0.5.0, confirmado). Dá contexto ao modelo e reduz chamadas.
   - NLLB 600M ou 1.3B em int8 via CTranslate2 (≈0,6 e ≈1,4 GB). Traduz direto entre todos os idiomas do escopo, mas frase por frase. Em fp16 o 1.3B (≈2,7 GB) não é mais leve que um LLM de 3 a 4B. Licença CC-BY-NC, compatível com uso pessoal.
   - Argos en→pb (direto, confirmado), a opção mais leve para inglês.
   - A licença de cada modelo fica registrada; alguns Qwen pequenos têm licença restrita (verificar).
   - **Um tradutor por vez:** o servidor mantém no máximo um carregado e descarrega o atual antes de carregar outro (no Ollama, com `keep_alive: 0` (verificar)). A troca espera as traduções em andamento terminarem e leva alguns segundos.
   - A escolha vai em cada pedido como opção `translator`; o servidor troca quando ela muda, entra na chave do cache (as traduções de cada um não se misturam) e aparece em `/v1/health`. Na CLI, a mesma escolha é `--translator`, usada no benchmark.
5. **VRAM e stack de IA.**
   - Detecção (por enquanto a do próprio RapidOCR; o comic-text-detector em ONNX entra como alternativa no benchmark da Fase 0, porque exige reproduzir o pré e o pós-processamento do modelo), OCR (RapidOCR, que roda os modelos do PaddleOCR em ONNX Runtime sem o PaddlePaddle) e LaMa (ONNX, entrada fixa de 512×512, aplicado por recorte) rodam em ONNX Runtime, primeiro na CPU e na GPU só se for preciso.
   - A GPU fica para o Ollama, com `keep_alive` longo (o padrão descarrega o modelo após 5 minutos parado).
   - O MVP não usa PyTorch; ele só entra com o manga-ocr (japonês, Fase 5). PaddlePaddle GPU e PyTorch fixam versões diferentes das bibliotecas CUDA e quebram um ao outro no mesmo ambiente (relatado em issues).
   - A Fase 0 tem um teste de ir/não ir: tudo carregado ao mesmo tempo, com o pico de VRAM medido.
6. **PWA no celular:** fora do plano. Se um dia for feita, precisa de HTTPS (Tailscale), porque `http://IP` não é contexto seguro.
7. **Firefox.**
   - O Firefox não suporta `background.service_worker`; o manifest declara os dois (`scripts` e `service_worker`). O Chrome 121+ ignora `scripts` e o Firefox 121+ usa `scripts`.
   - O WXT gera os builds dos dois navegadores a partir do mesmo código (o do Firefox com `--mv3`).
   - A partir do Firefox 127, `host_permissions` são concedidas na instalação, mas o usuário pode revogá-las; a extensão confere com `permissions.contains`.
   - O Firefox release exige XPI assinado para instalação permanente, também no desktop. As chaves da AMO ficam no `.env`.
8. **Python 3.12.** O PyTorch já suporta 3.15, mas RapidOCR e PaddlePaddle vão até 3.13.
9. **Código de terceiros.** O manga-image-translator (GPL-3.0, ativo, com modo API) é a referência de qualidade e tempo. O comic-text-detector também é GPL-3.0 e foi treinado com mangá, HQ antiga e imagens sintéticas. Com o projeto em GPL-3.0, reaproveitar código dos dois é permitido, citando a origem.
10. **Privacidade e segurança.**
    - Token obrigatório em todos os endpoints, inclusive `/v1/health` (a interface usa o health para testar o token). Na extensão, o token fica em `storage.local`.
    - O servidor não envia cabeçalhos CORS (desnecessários com `host_permissions`) e confere o cabeçalho `Host`, contra DNS rebinding.
    - Escuta em `127.0.0.1` por padrão; acesso pela rede só com opção explícita, de preferência pelo Tailscale (token em HTTP puro trafega em claro).
    - Content scripts só nos sites ligados pelo usuário. Tradução de texto desligada por padrão. Textos traduzidos nunca vão para logs.
11. **Dados de teste.** Os testes automáticos usam imagens sintéticas geradas pelos próprios testes. Páginas reais ficam em `samples/`, fora do git; só um manifesto (URL, SHA-256, anotações) é versionado. Pepper&Carrot fica de fora: apesar da licença CC BY 4.0, o autor publicou em outubro de 2026 um aviso proibindo derivações por IA.

## Estrutura do repositório

```
kmoverlay-translate/
├── extension/                     # WXT, TypeScript puro
│   ├── entrypoints/               # background, popup, options (content script na Fase 3)
│   ├── components/                # overlay da imagem, menu do celular, controles
│   ├── utils/                     # configurações, mensagens, status do servidor
│   ├── assets/                    # tokens visuais, ícone
│   ├── public/                    # ícones PNG e fontes (OFL)
│   └── tests/
├── server/                        # Python 3.12, FastAPI, uv
│   ├── src/kmoverlay_server/
│   │   ├── api/                   # rotas, autenticação, schemas
│   │   ├── pipeline/
│   │   │   ├── text_detector.py
│   │   │   ├── ocr_readers/       # interface + RapidOCR (MVP) + manga-ocr (japonês)
│   │   │   ├── translators/       # interface + Ollama, NLLB, Argos
│   │   │   ├── inpainter.py
│   │   │   ├── text_renderer.py
│   │   │   └── page_pipeline.py   # encadeia as etapas
│   │   ├── job_queue.py           # 1 worker, classes de prioridade, cancelamento
│   │   ├── result_cache.py        # cache por etapa, LRU
│   │   ├── settings.py
│   │   └── cli.py                 # kmoverlay translate | kmoverlay serve
│   ├── benchmarks/                # scripts e manifesto do conjunto de teste
│   └── tests/
├── samples/                       # páginas reais de teste, fora do git
├── docs/
└── LICENSE                        # GPL-3.0
```

## Contrato da API

Todos os endpoints exigem `Authorization: Bearer <token>`.

```
POST /v1/translate        multipart: images[] (uma ou várias, em ordem, para tiras) + options (JSON)
  options = { source_lang, target_lang, reading_direction: ltr | rtl | strip,
              output: image | regions, priority: visible | prefetch, series_id?,
              translator: ollama | nllb }
  → { pipeline_version,
      results: [{ image_sha256, image_webp_base64?,
                  regions: [{ polygon, source_text, translated_text }] }],
      timings_ms }
POST /v1/lookup           JSON: { image_sha256s, options } → mesmo formato ou 404 (sem reenviar a imagem)
POST /v1/translate-text   JSON: { texts, source_lang (aceita "auto"), target_lang, context? }
  → { translations, detected_lang }
GET  /v1/health           → { status, gpu_name, models_loaded, translator }
```

- `polygon` usa pixels da imagem original; o cliente converte para a escala exibida.
- `output: regions` devolve só as posições e os textos, sem a imagem renderizada (usado na captura da aba).
- Erros: `401` (token), `413` (imagem grande demais), `422` (entrada inválida), `429` (fila cheia) e `503` (modelo ou Ollama indisponível), sempre com corpo `{ error: { code, message } }`. Um cabeçalho `Host` desconhecido recebe `400`, sem corpo nesse formato.
- `priority` só ordena o trabalho e fica fora da chave do cache; `output` faz parte dela.
- O servidor sobe com `uv run kmoverlay serve`, o comando que o popup mostra quando não encontra o servidor. O token vem de `KMOVERLAY_TOKEN` no `server/.env` (modelo em `server/.env.example`).

## Interface

A UI da extensão foi desenhada no canvas "KMOverlay Translate — UX/UI" e implementada antes da Fase 0: popup, página de opções e componentes de página. O content script que liga esses componentes à fila entra na Fase 3.

- **Popup:** status do servidor (Conectado/Offline), site atual com "Ativo neste site" e os switches de imagens e texto, idiomas De → Para, progresso do capítulo e botão de alternar original e tradução. Offline, mostra o endereço, o comando para subir o servidor e o que continua funcionando pelo cache.
- **Opções:** Servidor (endereço, token, testar conexão), Idiomas, Sites, Tradução, Atalhos e Cache. Salvamento automático. A seção Tradução ganha o campo "Tradutor" (Ollama ou NLLB), que não está no canvas original.
- **Na imagem:** estados "na fila", "traduzindo", "traduzida" (controles Tradução/Original só ao passar o mouse) e "erro" (com "Tentar de novo"). Os indicadores ficam no topo da imagem, sem cobrir os balões.
- **No celular:** botão flutuante "KM" com menu (status, mostrar original, pausar no site, abrir painel).
- **Atalhos:** Alt+T alterna original e tradução; Alt+Shift+K liga ou desliga no site atual; Alt+Shift+C captura a área visível (Fase 8).
- Recursos de fases futuras (captura da aba, glossário) ficam escondidos até existirem.

## Fases

### Fase 0: validação técnica (só inglês)

- Preencher a seção "Projeto" do `AGENTS.md` com os comandos do servidor.
- **Benchmark de modelos:**
  - Conjunto em inglês (HQ, mangá traduzido e webtoon) em `samples/`, anotado com caixas e transcrições.
  - Tradução: LLMs de 3 a 4B, NLLB em int8 e Argos nas mesmas falas, incluindo o teste dos marcadores de formatação da Fase 4.
  - manga-image-translator nas mesmas páginas, como base de comparação.
  - Detecção e OCR em ONNX Runtime, comparando CPU e GPU.
  - Teste de ir/não ir de VRAM com tudo carregado ao mesmo tempo.
- **Esqueleto ponta a ponta:** servidor falso que devolve a imagem com caixas desenhadas, ligado à UI já existente, em 2 a 3 sites nomeados (uma página por imagem, um webtoon e um leitor paginado), no Chrome e no Firefox. Verifica: fetch e `Referer`, `blob:`, Local Network Access, mixed content, mensagens entre content e background, overlay e troca de `src`.
- Entregável: `docs/benchmark-fase-0.md`, com tabelas e decisões.

**Andamento (22/11/2026):** o esqueleto existe.
- Servidor: contrato da API (`/v1/health`, `/v1/translate`, `/v1/lookup`) com token, checagem de `Host`, limites de tamanho e cache em memória; pipeline de demonstração que só marca as imagens; leitor de demonstração em `/demo`, com HQs sintéticas geradas no código.
- Extensão: content script registrado só nos sites ligados (a permissão é pedida no popup), fila por proximidade da tela, camada isolada sobre cada imagem com os estados do design, Alt+T, badge com a fila e progresso no popup. O background baixa as imagens, consulta `/v1/lookup` e envia a `/v1/translate`.
- Conferido no Firefox (sem extensão instalada, com as APIs simuladas) que as camadas ficam sobre as imagens reais.
- Tradução comparada em [benchmark-fase-0.md](benchmark-fase-0.md): gemma3:4b com o prompt v2 é o padrão (chrF 65,6 contra 50,3 do qwen3:4b, ~1,4 s por página).
- Falta: testar a extensão instalada no Chrome e no Firefox, os sites reais (decisão em aberto), `Referer`, `blob:`, Local Network Access e mixed content; OCR e detecção num conjunto anotado; o NLLB.

**Pronto quando:**
- o modelo de tradução estiver escolhido;
- as metas estiverem definidas a partir da base de comparação: recall de detecção, taxa de erro de caracteres do OCR e nota cega de 1 a 3 da tradução;
- a latência estiver medida (p50 e p95 com o modelo carregado, partida a frio e páginas por minuto comparadas ao ritmo de leitura);
- o esqueleto funcionar nos sites nomeados.

### Fase 1: pipeline e CLI

- Inglês com RapidOCR; destino de teste pt-BR. OCR e tradutor atrás de interfaces, para os outros idiomas e modelos entrarem sem mexer no resto.
- Direção de leitura como parâmetro (`ltr`, `rtl`, `strip`), separada do idioma, porque mangá traduzido para o inglês continua da direita para a esquerda.
- Imagens altas divididas em blocos com sobreposição; tiras consecutivas juntadas para não cortar balões e divididas de volta no fim.
- Apagar o texto pela máscara do texto, não pela caixa (a caixa apaga a borda do balão).
- Escrever o texto na área do balão, não só na caixa do texto original, porque o português ocupa mais espaço. Fonte de HQ com licença OFL e acentos.
- Se o JSON do LLM vier com número errado de balões, traduzir balão por balão.
- CLI: `uv run kmoverlay translate pagina.jpg -o saida.png`.
- Testes com imagens sintéticas e tradutor falso, sem GPU.

**Pronto quando:** a CLI atingir as metas da Fase 0 no conjunto anotado.

**Andamento (22/11/2026):**
- Feito: OCR com RapidOCR (modelos PP-OCRv6 que vêm no pacote, ~1 s por página na CPU), leitura de imagens altas em blocos com sobreposição, filtro de desenhos lidos como letras, agrupamento das linhas em balões e ordem de leitura (`ltr`, `rtl`, `strip`), tiras juntadas e divididas de volta, apagamento pela máscara das letras com a cor do balão, escrita com Comic Neue Bold (OFL, com acentos) na área do balão, tradutor Ollama com JSON schema e fallback balão por balão, CLI `kmoverlay translate` e o servidor usando esse pipeline (`KMOVERLAY_PIPELINE=demo` volta ao de demonstração).
- Feito depois: tradução real testada com o Ollama (gemma3:4b), prompt v2, e pré-carregamento do OCR e do modelo quando o servidor sobe (a primeira página caiu de ~53 s para ~2 s; `KMOVERLAY_OLLAMA_KEEP_ALIVE` define quanto tempo o modelo fica na memória).
- Falta: o NLLB e a escolha do tradutor nas opções, e medir contra as metas da Fase 0.

### Fase 2: servidor HTTP

- FastAPI com o contrato acima e os modelos carregados uma única vez.
- Fila com 1 worker e classes de prioridade: texto > imagem visível > pré-carga. Cancela o pedido se o cliente desconectar antes de ele começar.
- Cache por etapa com teto e LRU.
- Segurança do item 10 dos ajustes.

**Pronto quando:** os testes de API passarem, incluindo os casos de erro, e a segunda chamada vier do cache.

### Fase 3: extensão de imagens

- Content script nos sites ligados, montando os componentes de página da UI.
- Ler imagens de `<img>` (usando `currentSrc`, que cobre `srcset` e `<picture>`), imagem de fundo via CSS, `<image>` em SVG e `<canvas>` sem bloqueio de CORS; filtrar só imagens grandes (tamanho mínimo numa constante).
- O content script controla a fila: `IntersectionObserver` com margem de ~1,5 tela, 1 a 2 pedidos em andamento, prioridade para o que está visível.
- Um `runtime.Port` por pedido (desconectar cancela). O background não guarda estado em memória, porque o service worker pode ser encerrado a qualquer momento; o estado fica no IndexedDB.
- A imagem traduzida chega ao content como data URL.
- Overlay sem capturar cliques (`pointer-events: none`), acompanhando o tamanho (`ResizeObserver`) e as trocas de `src`/`srcset` de leitores paginados.
- Badge do ícone com o número de páginas na fila.
- Tiras de webtoon agrupadas antes do envio.
- `MutationObserver` para imagens que entram por lazy-load.

**Pronto quando:** os sites nomeados forem traduzidos no Chrome e no Firefox e, ao voltar, a tradução vier do cache.

### Fase 4: texto da página (fecha o MVP)

- **Servidor:** `POST /v1/translate-text`, com o mesmo tradutor, fila e cache.
- **content:**
  - Traduzir por bloco (parágrafo, item de lista, célula). As tags internas viram marcadores numerados, como `Clique <0>aqui</0> para <1>continuar</1>`.
  - Nunca usar `innerHTML`: mover os elementos originais para a posição indicada pelo tradutor e mudar só o texto dos nós. Marcadores desconhecidos são descartados.
  - Marcadores faltando ou trocados: tentar mais uma vez; se falhar, traduzir nó por nó.
  - Ignorar `script`, `style`, `code`, `pre`, campos de formulário e nós já traduzidos.
  - Pular blocos que já estão no idioma de destino, pelo atributo `lang` e por `i18n.detectLanguage` (Chrome 47+, Firefox 47+, Firefox Android 106+; confirmado).
  - Traduzir só blocos perto da tela; `MutationObserver` para texto novo; guardar o original para alternar.
  - Não alterar o layout; reduzir a fonte só onde a tradução estourar, se a opção estiver ligada.
- Desligado por padrão, ligado por site.
- O Firefox já traduz texto offline, mas só tem modelos en↔pt; os outros idiomas chegam ao português passando pelo inglês. O Chrome tem a Translator API on-device (Chrome 138+, só desktop, en→pt incluído), uma alternativa leve para o texto da página no Chrome. A vantagem da extensão é usar o mesmo modelo, glossário e cache dos balões em todos os navegadores.

**Pronto quando:** as páginas de texto dos sites nomeados forem traduzidas mantendo o layout, os links e o negrito no meio das frases, e a tradução vier do cache ao recarregar.

### Fase 5: outros idiomas

- Benchmark de japonês, coreano, chinês, espanhol e russo, no mesmo formato da Fase 0.
- OCR: manga-ocr + PyTorch para o japonês; RapidOCR para coreano, chinês, espanhol e russo.
- Confirmar o detector em mangá, manhwa e manhua; se falhar, trocar ou combinar detectores.
- Idioma de origem escolhido por site; detectar o idioma pela imagem antes do OCR não é confiável.
- Destinos fora do alfabeto latino: fonte com os caracteres do idioma (ex.: família Noto, OFL) e quebra de linha por caractere em chinês e japonês.

**Pronto quando:** cada idioma atingir, no seu conjunto anotado, metas definidas da mesma forma que na Fase 0.

### Fase 6: qualidade

- LaMa por recorte nos fundos complexos.
- Contexto da página anterior no prompt e glossário de nomes por série.
- Opção de traduzir ou não as onomatopeias.

**Pronto quando:** a nota cega média da tradução subir em relação à Fase 0, sem passar da meta de latência.

### Fase 7: celular

- Build para o Firefox Android, instalado como XPI assinado por arquivo: Configurações → Sobre o Firefox → tocar 5 vezes no logo → "Install Extension from File" (Android 10+). Para desenvolver, `web-ext run -t firefox-android` via adb.
- Servidor acessível pela rede local ou pelo Tailscale, com token. Imagens em WebP, com o hash calculado antes da recompressão.

**Pronto quando:** um capítulo dos sites nomeados for traduzido no celular pela rede local e pelo Tailscale, aproveitando o cache feito no PC.

### Fase 8: captura da aba

- Para o que não pode ser lido direto: canvas bloqueado por CORS, imagens embaralhadas ou fatiadas por leitores e vídeo pausado.
- `captureVisibleTab` com o overlay escondido, no máximo 2 capturas por segundo, só quando a rolagem parar.
- O servidor devolve só `regions`; a extensão desenha caixas com o texto traduzido nas posições.
- Ativada pelo atalho Alt+Shift+C ou automaticamente quando a leitura direta falhar.

**Pronto quando:** um leitor que desenha as páginas em `<canvas>` for traduzido pelo atalho.

### Fase 9: opcional

- Opção B do estudo (tudo no navegador), só se uma medição justificar.

## Limitações conhecidas

- Nas imagens, o texto traduzido fica na posição e no balão originais, mas com uma fonte de HQ padrão, não a original.
- Na captura da aba, a posição e o tamanho são preservados, mas a fonte e o estilo são aproximados.
- Apps React ou Vue podem sobrescrever o texto traduzido ao renderizar de novo.
- Vídeo em reprodução não é traduzido em tempo real nesse hardware.
- Conteúdo com DRM aparece preto na captura.
- A extensão só atua dentro do navegador.
- A qualidade varia por par de idiomas; com um modelo de 3 a 4B, pares menos comuns (ex.: russo → português) podem sair piores.

## Decisões tomadas

- **Pipeline próprio** seguindo o contrato acima; manga-image-translator só como referência.
- **Dois tradutores, Ollama e NLLB**, com a escolha nas opções da extensão e só um carregado por vez.
- **Licença GPL-3.0.**
- **UI da extensão em TypeScript puro**, com as fontes Inter e Space Grotesk embutidas (OFL), sem requisições externas.
- **Dependências aprovadas:**
  - Servidor: FastAPI, Uvicorn, Pillow, NumPy, ONNX Runtime, RapidOCR, httpx, pytest e ruff. Depois: CTranslate2 (NLLB) e manga-ocr + PyTorch (japonês).
  - Extensão: WXT, TypeScript, Vitest e happy-dom.
  - Ferramenta: Ollama.

## Decisões em aberto

1. Quais 2 a 3 sites servem de teste nas Fases 0 a 4.
2. Como instalar o Ollama: o instalador oficial pede `sudo`; extrair o binário em `~/.local` também funciona, segundo relatos (verificar o uso da GPU nesse caso).
