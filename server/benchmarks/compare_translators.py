"""Compares Ollama models on the comic lines of `translation_samples.json`.

Usage (inside `server/`):
    uv run python benchmarks/compare_translators.py --models gemma3:4b qwen3:4b

Each model is loaded, timed on every page and unloaded before the next one,
because two 4B models do not fit together in 6 GB of VRAM.
"""

import argparse
import json
import statistics
import time
from dataclasses import dataclass
from pathlib import Path

from kmoverlay_server.evaluation import chrf
from kmoverlay_server.pipeline.translators import TranslationRequest
from kmoverlay_server.pipeline.translators.ollama import DEFAULT_OLLAMA_URL, OllamaTranslator

DEFAULT_SAMPLES = Path(__file__).with_name("translation_samples.json")


@dataclass
class ModelResult:
    model: str
    load_seconds: float
    page_seconds: list[float]
    scores: list[float]
    translations: list[list[str]]


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Compara modelos do Ollama na tradução de falas de HQ."
    )
    parser.add_argument("--models", nargs="+", required=True)
    parser.add_argument("--samples", type=Path, default=DEFAULT_SAMPLES)
    parser.add_argument("--ollama-url", default=DEFAULT_OLLAMA_URL)
    arguments = parser.parse_args()

    samples = json.loads(arguments.samples.read_text(encoding="utf-8"))
    request = TranslationRequest(samples["source_language"], samples["target_language"])
    results = [
        run_model(model, samples["pages"], request, arguments.ollama_url)
        for model in arguments.models
    ]
    print_summary(results)
    print_side_by_side(results, samples["pages"])


def run_model(model: str, pages: list[dict], request: TranslationRequest, url: str) -> ModelResult:
    translator = OllamaTranslator(base_url=url, model=model)
    started = time.perf_counter()
    translator.warm_up()
    result = ModelResult(model, time.perf_counter() - started, [], [], [])
    for page in pages:
        started = time.perf_counter()
        translations = translator.translate(page["segments"], request)
        result.page_seconds.append(time.perf_counter() - started)
        result.translations.append(translations)
        result.scores.extend(
            chrf(translation, reference)
            for translation, reference in zip(translations, page["references"], strict=True)
        )
    translator.unload()
    return result


def print_summary(results: list[ModelResult]) -> None:
    print("| Modelo | Carga (s) | Página, mediana (s) | Página, máx. (s) | chrF médio |")
    print("|---|---|---|---|---|")
    for result in results:
        print(
            f"| {result.model} | {result.load_seconds:.1f} "
            f"| {statistics.median(result.page_seconds):.1f} "
            f"| {max(result.page_seconds):.1f} | {statistics.mean(result.scores):.1f} |"
        )


def print_side_by_side(results: list[ModelResult], pages: list[dict]) -> None:
    for page_index, page in enumerate(pages):
        print(f"\n## Página {page_index + 1}")
        for segment_index, segment in enumerate(page["segments"]):
            print(f"\n{segment}\n  referência: {page['references'][segment_index]}")
            for result in results:
                print(f"  {result.model}: {result.translations[page_index][segment_index]}")


if __name__ == "__main__":
    main()
