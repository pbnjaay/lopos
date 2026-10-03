from apps.stores.models import Store


class SingleStoreColumnsMixin:
    """Masque les colonnes « magasin » tant que le commerce n'en a qu'un.

    Avec un seul magasin, la colonne répète le même nom sur chaque ligne et
    pousse les colonnes utiles hors de l'écran. Dès qu'un second magasin
    existe (même désactivé : son historique reste listé), elle revient.
    """

    store_columns: tuple[str, ...] = ("store",)

    def get_list_display(self, request):
        list_display = super().get_list_display(request)
        if Store.objects.count() > 1:
            return list_display
        return tuple(name for name in list_display if name not in self.store_columns)
