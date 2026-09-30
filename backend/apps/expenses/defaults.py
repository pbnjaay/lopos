"""Catégories proposées au premier démarrage : (nom, description obligatoire).

La description est exigée là où la catégorie seule ne dit pas ce qui a été
payé (« Autre », « Réparation »…).
"""

DEFAULT_CATEGORIES: tuple[tuple[str, bool], ...] = (
    ("Électricité", False),
    ("Eau", False),
    ("Transport", False),
    ("Service", True),
    ("Nettoyage", False),
    ("Réparation", True),
    ("Achat divers", True),
    ("Autre", True),
)
