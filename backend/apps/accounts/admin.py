from django.contrib import admin
from django.contrib.auth.admin import GroupAdmin as BaseGroupAdmin
from django.contrib.auth.admin import UserAdmin as BaseUserAdmin
from django.contrib.auth.models import Group, User
from django.http import HttpRequest, HttpResponseRedirect
from django.urls import reverse
from unfold.admin import ModelAdmin, TabularInline
from unfold.decorators import action
from unfold.forms import AdminPasswordChangeForm, UserChangeForm, UserCreationForm

from apps.stores.models import StoreAssignment


admin.site.unregister(User)
admin.site.unregister(Group)


class StoreAssignmentInline(TabularInline):
    model = StoreAssignment
    fields = ("store", "is_active")
    autocomplete_fields = ("store",)
    extra = 0
    verbose_name = "boutique autorisée"
    verbose_name_plural = "boutiques autorisées"


@admin.register(User)
class UserAdmin(BaseUserAdmin, ModelAdmin):
    form = UserChangeForm
    add_form = UserCreationForm
    change_password_form = AdminPasswordChangeForm
    inlines = (StoreAssignmentInline,)
    # Le formulaire de mot de passe existe déjà (page dédiée), mais son seul
    # accès est un lien discret noyé dans le texte d'aide sous le champ
    # "password" — facile à manquer. Ce bouton en haut de la fiche y mène
    # directement, sans dupliquer le formulaire.
    actions_detail = ["change_password_action"]

    @action(
        description="Changer le mot de passe",
        icon="password",
        url_path="changer-mot-de-passe",
        permissions=["change"],
    )
    def change_password_action(
        self, request: HttpRequest, object_id: str
    ) -> HttpResponseRedirect:
        return HttpResponseRedirect(
            reverse("admin:auth_user_password_change", args=[object_id])
        )

    def get_fieldsets(self, request: HttpRequest, obj: User | None = None):
        fieldsets = super().get_fieldsets(request, obj)
        if request.user.is_superuser:
            return fieldsets

        # Un gérant gère les comptes caissiers (créer, désactiver, réinitialiser
        # le mot de passe) mais ne doit jamais pouvoir s'accorder — à lui-même
        # ou à quiconque — le statut super-utilisateur, un groupe ou une
        # permission Django : seul un compte superuser garde la main dessus.
        restricted_fields = {"is_staff", "is_superuser", "groups", "user_permissions"}
        return tuple(
            (title, {**options, "fields": tuple(
                field for field in options["fields"] if field not in restricted_fields
            )})
            for title, options in fieldsets
        )

    def has_change_permission(
        self, request: HttpRequest, obj: User | str | None = None
    ) -> bool:
        if not super().has_change_permission(request, obj):
            return False
        if request.user.is_superuser or obj is None:
            return True

        # Un gérant ne doit jamais pouvoir modifier — ni réinitialiser le mot
        # de passe d' — un compte super-utilisateur. `obj` est soit l'instance
        # (formulaire d'édition standard) soit le pk brut (vérification de
        # permission du bouton "Changer le mot de passe" ci-dessus).
        target = obj if isinstance(obj, User) else User.objects.filter(pk=obj).first()
        return target is None or not target.is_superuser


@admin.register(Group)
class GroupAdmin(BaseGroupAdmin, ModelAdmin):
    pass
