from apps.stores.models import Store
from apps.tenancy.admin_mixins import visible_queryset


class SingleStoreColumnsMixin:
    """Masque les colonnes « magasin » tant que le commerce n'en a qu'un.

    Avec un seul magasin, la colonne répète le même nom sur chaque ligne et
    pousse les colonnes utiles hors de l'écran. Dès qu'un second magasin
    visible existe (même désactivé : son historique reste listé), elle
    revient. Seuls comptent les magasins que le compte voit : ceux d'un
    autre commerce ne doivent rien changer à l'écran.
    """

    store_columns: tuple[str, ...] = ("store",)

    def get_list_display(self, request):
        list_display = super().get_list_display(request)
        if visible_queryset(Store, request).count() > 1:
            return list_display
        return tuple(name for name in list_display if name not in self.store_columns)
