# Plano de implementação

Plano para construir a extensão de tradução de mangá descrita em [extensao-traducao.md](../extensao-traducao.md). Versão inicial de 21/11/2026.

## Premissas

- Idiomas de origem nas imagens: japonês, coreano, chinês, inglês, espanhol e russo. A implementação começa pelo inglês; os demais entram na Fase 4c.
- Idioma de origem no texto da página: qualquer um que o LLM entenda.
- Idioma de destino: configurável. O padrão é português do Brasil, o único testado no início.
- Escopo: texto dentro das imagens (balões) e texto comum das páginas.
- Uso pessoal, sem distribuição comercial.
- Navegadores: Chrome e Firefox no PC; Firefox no Android.
- Arquitetura: opção A do estudo, com a extensão no navegador e o servidor local em Python.

### Hardware de referência

| Item | Valor |
|---|---|
| GPU | NVIDIA RTX 3050 Laptop, 6 GB de VRAM |
| RAM | 16 GB |
| Ferramentas | Python 3.15 (sistema), Node 22, `uv`, `npm`; Ollama não instalado |

## Ajustes em relação ao estudo

1. **Captura da imagem.** O background script baixa os bytes da imagem, o que não sofre bloqueio de CORS quando a extensão tem `host_permissions`, e envia esses bytes ao servidor.
   - O canvas fica bloqueado por CORS em imagens de outros domínios.
   - `captureVisibleTab` só pega a parte visível, captura o próprio overlay e tem limite de chamadas por segundo. Fica só como alternativa.
   - Enviar apenas a URL para o servidor baixar não funciona bem: muitos sites bloqueiam hotlink.
2. **Só o background fala com o servidor.** Uma página HTTPS chamando `http://localhost` ou o IP do PC pelo content script é bloqueada como conteúdo misto e pela proteção de rede privada do Chrome.
3. **Cache em duas camadas.** IndexedDB no navegador e cache em disco no servidor, que o PC e o celular compartilham. A chave é o SHA-256 da imagem + o idioma de destino + a versão do pipeline. Sem a versão, uma melhoria no pipeline nunca substitui as traduções antigas.
4. **Tradução offline com LLM.**
   - Argos: provavelmente traduz ja→pt passando pelo inglês, o que piora o resultado (verificar).
   - NLLB: a licença é CC-BY-NC, ou seja, proíbe uso comercial.
   - Escolha: um LLM local via Ollama que traduz a página inteira numa só chamada, com os balões numerados em ordem de leitura e resposta em JSON. Isso dá contexto ao modelo e reduz a latência.
5. **Limite de 6 GB de VRAM.** Não cabe um LLM de 7B junto com detecção, OCR e LaMa.
   - Começar com um modelo de 3 a 4B quantizado e medir.
   - Apagar o texto pintando com a cor do balão por padrão; usar o LaMa só quando o fundo não for liso.
6. **PWA no celular fica para o fim.**
   - Acessada por `http://IP`, a página não é um contexto seguro: fica sem service worker e sem `crypto.subtle`.
   - O servidor teria de baixar as páginas do site de mangá no lugar do navegador, o que esbarra nos bloqueios.
   - Se for feita, usar o HTTPS do Tailscale.
7. **Firefox.** No Manifest V3 do Firefox o background não é um service worker (usa `background.scripts`). O build precisa gerar um manifest para cada navegador.
8. **Versão do Python.** Fixar Python 3.12 no projeto com `uv`, porque PyTorch e onnxruntime costumam demorar a publicar versões para Python novo.
9. **Não reinventar o pipeline.** O manga-image-translator já implementa o pipeline inteiro e tem modo servidor. Ele serve de referência de qualidade e de tempo na Fase 0. A licença deve ser GPL-3.0 (confirmar); copiar código dele torna o projeto GPL.

## Estrutura do repositório

```
kmoverlay-translate/
├── server/                        # Python 3.12, FastAPI, uv
│   ├── src/kmoverlay_server/
│   │   ├── api/                   # rotas, autenticação, schemas
│   │   ├── pipeline/
│   │   │   ├── text_detector.py
│   │   │   ├── ocr_readers/       # interface + manga-ocr (ja) + PaddleOCR (demais)
│   │   │   ├── translators/       # interface + ollama (nuvem depois)
│   │   │   ├── inpainter.py
│   │   │   ├── text_renderer.py
│   │   │   └── page_pipeline.py   # encadeia as etapas
│   │   ├── job_queue.py           # 1 worker de GPU, prioridade, cancelamento
│   │   ├── result_cache.py
│   │   ├── settings.py
│   │   └── cli.py
│   └── tests/fixtures/            # páginas de exemplo
├── extension/                     # TypeScript, Manifest V3
│   └── src/{background,content,popup,options,shared}/
└── docs/
```

## Contrato da API

```
POST /v1/translate     (Authorization: Bearer <token>, multipart: image, source_lang, target_lang)
  → { image_sha256, pipeline_version, image_webp_base64,
      regions: [{ box, source_text, translated_text }],
      timings_ms: { detect, ocr, translate, inpaint, render } }
GET  /v1/translate/{sha256}?target_lang=pt-BR   → resultado ou 404 (evita reenviar a imagem)
POST /v1/translate-text (Authorization: Bearer <token>, JSON: { texts, source_lang, target_lang })
  → { translations }                            (mesma ordem de texts)
GET  /v1/health                                 → modelos carregados, GPU
```

O campo `regions` permite depurar o resultado, alternar entre original e tradução e, no futuro, editar a tradução ou desenhar o texto no próprio cliente.

## Fases

### Fase 0: validação técnica

- Rodar `git init` e preencher a seção "Projeto" do `AGENTS.md`.
- Instalar o Ollama e testar 2 ou 3 modelos de 3 a 4B.
- Montar um conjunto de 15 a 20 páginas de teste em inglês (balão branco, fundo complexo, onomatopeias e texto em caixa alta), mais algumas páginas de cada um dos outros idiomas, incluindo texto vertical em japonês.
- Medir tempo e VRAM de cada etapa e rodar o manga-image-translator nas mesmas páginas.
- Testar o detector e o PaddleOCR em todas as páginas, começando pelas em inglês. O comic-text-detector parece ter sido feito principalmente para mangá; confirmar que funciona bem em HQ ocidental.

**Pronto quando:** houver uma tabela de tempos por etapa e o modelo de tradução estiver escolhido. Se o tempo passar muito de ~5 s por página, revisar o plano.

### Fase 1: pipeline e CLI

- Origem desta fase: inglês, com OCR pelo PaddleOCR; destino de teste: pt-BR. O OCR fica atrás de uma interface por idioma, para os outros entrarem na Fase 4c sem mudar o resto.
- Etapas com interfaces separadas, na ordem detecção → OCR → tradução → apagar o texto → escrever o texto.
- Balões ordenados na ordem de leitura do inglês: da esquerda para a direita, de cima para baixo.
- Apagar o texto pintando com a cor do balão.
- Escrever o texto na horizontal, com quebra de linha e o maior tamanho de fonte que couber na caixa, usando uma fonte de HQ com licença OFL e acentos.
- CLI: `uv run kmoverlay translate pagina.jpg -o saida.png`.
- Testes: layout do texto, ordem de leitura e o pipeline com um tradutor falso, que rodam sem GPU.

**Pronto quando:** a CLI traduzir as páginas de teste com resultado legível.

### Fase 2: servidor HTTP

- FastAPI com os modelos carregados uma única vez e uma fila com 1 worker de GPU.
- Cancelar o trabalho se o cliente desconectar antes de ele começar.
- Cache em disco.
- Segurança: escutar em `127.0.0.1` por padrão, token obrigatório, CORS liberado só para a extensão, limite de tamanho em bytes e em pixels.

**Pronto quando:** um `curl` com uma imagem devolver a tradução e a segunda chamada vier do cache.

### Fase 3: extensão no PC (MVP)

- **content:**
  - Ler imagens de todas as fontes: `<img>` (usando `currentSrc`, que cobre `srcset` e `<picture>`), imagem de fundo via CSS, `<image>` em SVG e `<canvas>` (quando não estiver bloqueado por CORS).
  - O que não puder ser lido direto vai para o modo de captura da aba (Fase 4b).
  - Filtrar só imagens grandes (tamanho mínimo numa constante).
  - `IntersectionObserver` com margem de cerca de 1,5 tela.
  - Fila com prioridade (visível > próxima), processando uma imagem por vez.
  - Cancelamento com `AbortController`.
  - `MutationObserver` para imagens que entram por lazy-load.
- **background:** baixa os bytes da imagem, calcula o SHA-256 e procura nesta ordem: IndexedDB → `GET` por hash no servidor → `POST`.
- **overlay:** imagem posicionada por cima da original, acompanhando o tamanho com `ResizeObserver`, mais um indicador de carregamento e um atalho para alternar entre original e tradução.
- **popup e opções:** ligar e desligar por site, URL do servidor, token, idioma de origem por site e idioma de destino.
- Testes da fila e do cache com Vitest e teste manual em 2 ou 3 sites reais.

**Pronto quando:** ao rolar um capítulo, as páginas aparecerem traduzidas e, ao voltar, a tradução vier do cache.

### Fase 3b: texto da página

- **Servidor:** endpoint `POST /v1/translate-text`, que usa o mesmo tradutor, glossário, fila e cache das imagens. Chave do cache: hash do texto + idioma de destino + versão do pipeline. O prompt instrui o modelo a manter os marcadores de formatação (ver abaixo).
- **content:**
  - Percorrer os nós de texto do DOM, ignorando `script`, `style`, `code`, `pre`, campos de formulário e nós já traduzidos.
  - Traduzir por bloco (parágrafo, item de lista, célula), não por nó. As tags internas (`a`, `b`, `i`, `span`…) viram marcadores numerados, como `Clique <0>aqui</0> para <1>continuar</1>`, e depois da tradução voltam ao ponto indicado pelo modelo, mantendo links, negrito e estilos.
  - Se a tradução vier com marcadores faltando ou trocados, tentar mais uma vez; se falhar de novo, traduzir nó por nó. A frase fica menos fluida, mas os links e estilos são preservados.
  - Não alterar o layout: a extensão troca só o texto. Como opção, reduzir a fonte apenas nos elementos em que a tradução estourar o espaço.
  - Traduzir só os blocos perto da tela (`IntersectionObserver`), com as frases de cada bloco numa única chamada.
  - `MutationObserver` para o texto que aparece depois (scroll infinito, comentários).
  - Guardar o texto original para alternar entre original e tradução.
- **Opções:** ligar a tradução de texto e a de imagens separadamente, por site.
- Testes com Vitest, em ambiente de DOM simulado: seleção dos blocos, ida e volta dos marcadores e o caminho de falha.

O Firefox já traduz o texto das páginas offline, com modelos locais (verificar se o par ja→pt está disponível). A vantagem de fazer na extensão é usar o mesmo modelo e glossário dos balões e ter tradução offline também no Chrome.

**Pronto quando:** uma página com texto for traduzida mantendo o layout, os links e o negrito no meio das frases, e a tradução vier do cache ao recarregar.

### Fase 4: qualidade

- LaMa só em fundos complexos.
- Contexto da página anterior no prompt e glossário de nomes por série.
- Configuração para traduzir ou não as onomatopeias.
- Medir de novo e comparar com a Fase 0.

### Fase 4b: modo de captura da aba

Cobre o que não pode ser lido direto da página: canvas bloqueado por CORS, imagens embaralhadas ou fatiadas por leitores e vídeo pausado.

- Capturar a área visível com `captureVisibleTab`, escondendo o overlay antes da captura.
- Servidor: o mesmo pipeline, devolvendo só `regions` (posição e texto traduzido), sem a imagem renderizada.
- Extensão: desenhar caixas com o texto traduzido nas posições detectadas, por cima da página.
- Traduzir só quando a rolagem parar e respeitar o limite de capturas por segundo do navegador.
- Ativar por atalho ou automaticamente quando a leitura direta da imagem falhar.

**Pronto quando:** um leitor que desenha as páginas em `<canvas>` for traduzido pelo atalho.

### Fase 4c: outros idiomas

- **OCR:** Manga-OCR para o japonês; PaddleOCR para coreano, chinês, espanhol e russo (confirmar a qualidade em balões no benchmark).
- **Detector:** confirmar que o detector escolhido na Fase 0 encontra texto em mangá, manhwa e manhua; se não encontrar, trocar ou combinar detectores.
- **Ordem de leitura por idioma:** da direita para a esquerda no japonês e no chinês vertical; da esquerda para a direita nos demais.
- **Webtoons:** juntar as tiras vizinhas antes da detecção, para não cortar balões entre duas imagens, e dividir o resultado de volta.
- **Idioma de origem:** escolhido por site nas opções, com um padrão global. Detectar o idioma pela imagem antes do OCR não é confiável.
- **Destinos fora do alfabeto latino:** fonte com os caracteres do idioma (ex.: família Noto, licença OFL) e quebra de linha por caractere em chinês e japonês.

**Pronto quando:** pelo menos uma página de cada idioma de origem do conjunto de teste for traduzida com resultado legível.

### Fase 5: celular

- Build da extensão para o Firefox Android. Para desenvolver, `web-ext run -t firefox-android` via adb. Para uso diário, a extensão provavelmente precisa ser assinada pela Mozilla como "unlisted" (verificar).
- Servidor acessível pela rede local ou pelo Tailscale, com token obrigatório. Enviar as imagens em WebP para reduzir a transferência.

### Fase 6: opcional

- Opção B do estudo (tudo no navegador), só se houver motivo.

## Limitações conhecidas

- Nas imagens, o texto traduzido fica na mesma posição e dentro do balão, mas com uma fonte de HQ padrão, não a fonte original.
- No modo de captura, a posição e o tamanho do texto são preservados, mas a fonte e o estilo são aproximados.
- Vídeo em reprodução não é traduzido em tempo real nesse hardware.
- Conteúdo com DRM aparece preto na captura e não pode ser traduzido.
- A extensão só atua dentro do navegador.
- A qualidade da tradução varia por par de idiomas. Com um modelo de 3 a 4B, pares menos comuns (ex.: russo → português) podem sair piores.

## Decisões em aberto

1. **Pipeline próprio ou manga-image-translator como backend.** Recomendação: pipeline próprio seguindo o contrato da API acima, com o manga-image-translator só como referência. Usá-lo como backend entrega mais rápido, mas é pesado e dá menos controle.
2. **Dependências a aprovar.** Servidor: FastAPI, Pillow, manga-ocr, PaddleOCR, PyTorch e o detector de texto. Extensão: Vite ou WXT, Vitest e web-ext. Confirmar licença e manutenção de cada uma antes de adicionar.
