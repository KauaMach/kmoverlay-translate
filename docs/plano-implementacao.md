# Plano de implementação

Plano para construir a extensão de tradução de mangá descrita em [extensao-traducao.md](../extensao-traducao.md). Versão inicial de 21/11/2026.

## Premissas

- Origem: mangá em japonês. Destino: português do Brasil.
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
│   │   │   ├── ocr_reader.py
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
GET  /v1/health                                 → modelos carregados, GPU
```

O campo `regions` permite depurar o resultado, alternar entre original e tradução e, no futuro, editar a tradução ou desenhar o texto no próprio cliente.

## Fases

### Fase 0: validação técnica

- Rodar `git init` e preencher a seção "Projeto" do `AGENTS.md`.
- Instalar o Ollama e testar 2 ou 3 modelos de 3 a 4B.
- Montar um conjunto de 15 a 20 páginas de teste: balão branco, fundo complexo, texto vertical e onomatopeias.
- Medir tempo e VRAM de cada etapa e rodar o manga-image-translator nas mesmas páginas.

**Pronto quando:** houver uma tabela de tempos por etapa e o modelo de tradução estiver escolhido. Se o tempo passar muito de ~5 s por página, revisar o plano.

### Fase 1: pipeline e CLI

- Etapas com interfaces separadas, na ordem detecção → OCR → tradução → apagar o texto → escrever o texto.
- Balões ordenados em ordem de leitura japonesa: da direita para a esquerda, de cima para baixo.
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
  - Filtrar só imagens grandes (tamanho mínimo numa constante).
  - `IntersectionObserver` com margem de cerca de 1,5 tela.
  - Fila com prioridade (visível > próxima), processando uma imagem por vez.
  - Cancelamento com `AbortController`.
  - `MutationObserver` para imagens que entram por lazy-load.
- **background:** baixa os bytes da imagem, calcula o SHA-256 e procura nesta ordem: IndexedDB → `GET` por hash no servidor → `POST`.
- **overlay:** imagem posicionada por cima da original, acompanhando o tamanho com `ResizeObserver`, mais um indicador de carregamento e um atalho para alternar entre original e tradução.
- **popup e opções:** ligar e desligar por site, URL do servidor, token e idioma.
- Testes da fila e do cache com Vitest e teste manual em 2 ou 3 sites reais.

**Pronto quando:** ao rolar um capítulo, as páginas aparecerem traduzidas e, ao voltar, a tradução vier do cache.

### Fase 4: qualidade

- LaMa só em fundos complexos.
- Contexto da página anterior no prompt e glossário de nomes por série.
- Configuração para traduzir ou não as onomatopeias.
- Medir de novo e comparar com a Fase 0.

### Fase 5: celular

- Build da extensão para o Firefox Android. Para desenvolver, `web-ext run -t firefox-android` via adb. Para uso diário, a extensão provavelmente precisa ser assinada pela Mozilla como "unlisted" (verificar).
- Servidor acessível pela rede local ou pelo Tailscale, com token obrigatório. Enviar as imagens em WebP para reduzir a transferência.

### Fase 6: opcional

- Tradução do texto comum das páginas.
- Opção B do estudo (tudo no navegador), só se houver motivo.

## Decisões em aberto

1. **Idioma de origem.** Se incluir manhwa coreano ou manhua chinês, o Manga-OCR não serve (só lê japonês) e é preciso outro OCR, como o PaddleOCR. Webtoons também costumam vir fatiados em várias imagens, com balões cortados entre elas, o que exige juntar as fatias.
2. **Pipeline próprio ou manga-image-translator como backend.** Recomendação: pipeline próprio seguindo o contrato da API acima, com o manga-image-translator só como referência. Usá-lo como backend entrega mais rápido, mas é pesado e dá menos controle.
3. **Dependências a aprovar.** Servidor: FastAPI, Pillow, manga-ocr, PyTorch e o detector de texto. Extensão: Vite ou WXT, Vitest e web-ext. Confirmar licença e manutenção de cada uma antes de adicionar.
