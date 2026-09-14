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


@admin.register(Group)
class GroupAdmin(BaseGroupAdmin, ModelAdmin):
    pass
