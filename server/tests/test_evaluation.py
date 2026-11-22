import pytest

from kmoverlay_server.evaluation import chrf


def test_identical_translations_score_100() -> None:
    assert chrf("Você se atrasou de novo!", "Você se atrasou de novo!") == pytest.approx(100)


def test_capitalization_and_spaces_are_ignored() -> None:
    assert chrf("VOCÊ SE ATRASOU  DE NOVO!", "Você se atrasou de novo!") == pytest.approx(100)


def test_closer_translations_score_higher() -> None:
    reference = "Sempre a mesma desculpa..."

    close = chrf("Sempre a mesma desculpa!", reference)
    far = chrf("Só a mesma desculpa...", reference)
    unrelated = chrf("Bom dia", reference)

    assert 100 > close > far > unrelated >= 0


def test_empty_texts() -> None:
    assert chrf("", "") == 100.0
    assert chrf("", "Oi") == 0.0
