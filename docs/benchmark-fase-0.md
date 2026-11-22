# Benchmark da Fase 0

Resultados das medições da Fase 0 (ver [plano-implementacao.md](plano-implementacao.md)). Cada seção diz como foi medido, para poder repetir.

## Tradução (22/11/2026)

### Método

- **Conjunto:** 26 falas de HQ em inglês, em 6 "páginas", com traduções de referência. Falas e referências foram escritas para o projeto (`server/benchmarks/translation_samples.json`) e vêm em maiúsculas, como o OCR as lê.
- **Execução:** cada página é traduzida numa única chamada, como no servidor. Cada modelo é carregado, medido e descarregado antes do próximo, porque dois modelos de 4B não cabem juntos em 6 GB.
- **Medidas:** tempo de carga do modelo, tempo por página (mediana e máximo) e chrF médio. O chrF vai de 0 a 100 e mede a semelhança de caracteres com a referência.
- **Ambiente:** RTX 3050 Laptop 6 GB, Ollama 0.40.17.
- **Comando** (em `server/`): `uv run python benchmarks/compare_translators.py --models gemma3:4b qwen3:4b`

### Resultados

| Modelo | Prompt | Carga (s) | Página, mediana (s) | Página, máx. (s) | chrF médio |
|---|---|---|---|---|---|
| gemma3:4b | v1 | 7,0 | 1,3 | 1,6 | 60,1 |
| qwen3:4b | v1 | 4,1 | 1,9 | 2,3 | 45,3 |
| gemma3:4b | **v2** | 4,3 | 1,4 | 1,7 | **65,6** |
| qwen3:4b | v2 | 3,2 | 1,5 | 1,5 | 50,3 |

O **prompt v2** acrescenta ao v1:
- avisa que as maiúsculas vêm do OCR;
- pede português do Brasil falado, sem formas de Portugal;
- manda traduzir expressões pelo sentido e usar a cena como contexto;
- inclui dois exemplos de tradução, que não fazem parte do conjunto de avaliação.

### Observações

- **qwen3:4b:**
  - Mesmo com `think: false`, o Ollama deixa o modelo raciocinar por escrito antes de responder: uma frase levou 103 s.
  - Com a resposta restrita por JSON schema, como o servidor faz, ele responde direto, mas inventa palavras: "TREINHO", "SURROUDEM", "PROBABILMENTE", "BRAÇO DE BOM DIA".
- **gemma3:4b com o prompt v2:** soa como fala brasileira ("Você se atrasou de novo!", "Eles cercaram a gente!", "Você tá maluco?!", "Eu tô aqui pro campeonato"). Ainda erra:
  - o sentido pela cena: "Desce!" para GET DOWN! num tiroteio;
  - expressões de ação: "Cobre pra mim!" para COVER ME!;
  - expressões idiomáticas: "Boa sorte lá fora!" para BREAK A LEG.
- **Carga do modelo:**
  - Logo depois de ligar o PC, com o disco frio, leva uns 50 s; nas cargas seguintes, de 4 a 7 s.
  - Com o pré-carregamento ao subir o servidor, a primeira página levou 2,3 s.
- **Memória:** com o gemma3:4b carregado, a GPU fica com 3,8 GB ocupados dos 6 GB.

### Decisão

O padrão é o **gemma3:4b com o prompt v2**. O conjunto é pequeno e as referências são do próprio projeto, então a nota serve para comparar versões e modelos, não como medida absoluta de qualidade.

### Falta

- OCR e detecção num conjunto anotado de páginas reais (`samples/`).
- NLLB.
- Latência ponta a ponta no navegador.
