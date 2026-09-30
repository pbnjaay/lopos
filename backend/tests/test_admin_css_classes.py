"""Toute classe utilitaire de nos pages d'admin existe dans la CSS d'Unfold.

Unfold livre une CSS Tailwind précompilée : une classe absente de sa
compilation (ex. `sm:grid-cols-3`, `text-amber-600`) est ignorée sans
erreur, et la mise en page casse en silence — cartes empilées, alertes sans
couleur. Ce test liste nos classes et vérifie qu'elles y sont toutes.
"""

import re
from pathlib import Path

import unfold

BACKEND = Path(__file__).resolve().parents[1]
UNFOLD_CSS = (Path(unfold.__file__).parent / "static/unfold/css/styles.css").read_text()

# Nos templates d'admin, et le HTML écrit dans les admin.py (format_html).
SOURCES = [
    *BACKEND.glob("apps/*/templates/**/*.html"),
    *BACKEND.glob("apps/*/admin.py"),
    *BACKEND.glob("apps/*/templatetags/*.py"),
]

_CLASS_ATTR = re.compile(r"""class\s*=\s*(["'])(.*?)\1""", re.DOTALL)
_TEMPLATE_CODE = re.compile(r"{%.*?%}|{{.*?}}", re.DOTALL)
# Classes qui ne sont pas des utilitaires Tailwind : Django admin, icônes,
# ou classes propres à Unfold/Django.
NOT_TAILWIND = {"material-symbols-outlined", "module", "vLargeTextField"}


def _classes(source: str) -> set[str]:
    found = set()
    for _quote, value in _CLASS_ATTR.findall(source):
        value = _TEMPLATE_CODE.sub(" ", value)
        # Chaînes Python concaténées (`"a b " "c d"`) : on ne garde que les mots.
        found.update(word for word in re.split(r"[\s\"']+", value) if word)
    return found


def _in_unfold_css(cls: str) -> bool:
    escaped = re.sub(r"([:./\[\]%])", r"\\\1", cls)
    return f".{escaped}" in UNFOLD_CSS


def test_every_admin_utility_class_exists_in_unfold_css() -> None:
    missing = {}
    for path in SOURCES:
        for cls in _classes(path.read_text()):
            if cls in NOT_TAILWIND or not re.match(r"^[a-z:\[\]0-9./%-]+$", cls):
                continue
            if not _in_unfold_css(cls):
                missing.setdefault(cls, []).append(str(path.relative_to(BACKEND)))

    assert not missing, "Classes absentes de la CSS d'Unfold : " + ", ".join(
        f"{cls} ({', '.join(sorted(set(paths)))})" for cls, paths in sorted(missing.items())
    )
