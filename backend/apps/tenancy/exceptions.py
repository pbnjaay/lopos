class CrossTenantReference(Exception):
    """Deux objets de commerces différents réunis dans une même opération.

    L'API ne peut pas y mener (chaque identifiant reçu est cherché dans le
    commerce du compte) : la lever signale un chemin oublié, à corriger."""


def ensure_same_organization(*objects) -> None:
    organizations = {obj.organization_id for obj in objects}
    if len(organizations) > 1:
        names = ", ".join(f"{type(obj).__name__} {obj.pk}" for obj in objects)
        raise CrossTenantReference(f"Commerces différents : {names}.")
