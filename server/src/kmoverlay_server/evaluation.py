"""Quality measures used by the benchmarks (Fase 0)."""

import re
from collections import Counter

CHRF_MAX_ORDER = 6
# chrF2 weighs recall twice as much as precision, the usual setting.
CHRF_BETA = 2.0
WHITESPACE = re.compile(r"\s+")


def chrf(hypothesis: str, reference: str) -> float:
    """chrF score (0 to 100): character n-gram overlap between a translation and a reference.

    Capitalization and spaces are ignored, because the OCR text is in capitals
    and the renderer decides the case anyway.
    """
    hypothesis_chars = _normalize(hypothesis)
    reference_chars = _normalize(reference)
    precisions = []
    recalls = []
    for order in range(1, CHRF_MAX_ORDER + 1):
        hypothesis_grams = _ngrams(hypothesis_chars, order)
        reference_grams = _ngrams(reference_chars, order)
        if not hypothesis_grams or not reference_grams:
            continue
        overlap = sum((hypothesis_grams & reference_grams).values())
        precisions.append(overlap / sum(hypothesis_grams.values()))
        recalls.append(overlap / sum(reference_grams.values()))
    if not precisions:
        return 100.0 if hypothesis_chars == reference_chars else 0.0
    precision = sum(precisions) / len(precisions)
    recall = sum(recalls) / len(recalls)
    if precision == 0 and recall == 0:
        return 0.0
    beta_squared = CHRF_BETA**2
    return 100 * (1 + beta_squared) * precision * recall / (beta_squared * precision + recall)


def _normalize(text: str) -> str:
    return WHITESPACE.sub("", text.upper())


def _ngrams(text: str, order: int) -> Counter[str]:
    return Counter(text[index : index + order] for index in range(len(text) - order + 1))
