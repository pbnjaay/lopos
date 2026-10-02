from django import forms
from django.contrib import admin
from django.contrib.admin.utils import flatten_fieldsets
from django.contrib.auth.admin import GroupAdmin as BaseGroupAdmin
from django.contrib.auth.admin import UserAdmin as BaseUserAdmin
from django.contrib.auth.models import Group, User
from django.http import HttpRequest, HttpResponseRedirect
from django.urls import reverse
from django.utils.translation import gettext_lazy as _
from unfold.admin import ModelAdmin, TabularInline
from unfold.decorators import action
from unfold.forms import AdminPasswordChangeForm, UserChangeForm, UserCreationForm
from unfold.widgets import UnfoldAdminSelectWidget, UnfoldBooleanSwitchWidget

from apps.stores.models import StoreAssignment
from apps.tenancy.admin_mixins import TenantAdminMixin, is_platform_admin
from apps.tenancy.context import get_tenant
from apps.tenancy.models import OrganizationMembership
from apps.tenancy.roles import sync_member_access

Role = OrganizationMembership.Role

# Ce qu'un propriétaire attribue : jamais propriétaire (la plateforme seule
# en nomme un), jamais super-utilisateur.
ASSIGNABLE_ROLES = ((Role.MANAGER, Role.MANAGER.label), (Role.CASHIER, Role.CASHIER.label))
MEMBER_FIELDS = ("role", "can_view_costs")


admin.site.unregister(User)
admin.site.unregister(Group)


def _role_field() -> forms.ChoiceField:
    return forms.ChoiceField(
        label="Rôle",
        choices=ASSIGNABLE_ROLES,
        initial=Role.CASHIER,
        required=False,
        help_text="Le gérant a accès au back-office pour ses magasins ; le caissier, à la caisse seulement.",
        widget=UnfoldAdminSelectWidget(),
    )


def _costs_field() -> forms.BooleanField:
    return forms.BooleanField(
        label="Voit les coûts et marges",
        required=False,
        help_text="Pour un gérant : coût d'achat, valeur du stock et marges.",
        widget=UnfoldBooleanSwitchWidget(),
    )


class MemberCreationForm(UserCreationForm):
    role = _role_field()
    can_view_costs = _costs_field()


class MemberChangeForm(UserChangeForm):
    role = _role_field()
    can_view_costs = _costs_field()

    def clean_is_superuser(self):
        # Champ présent pour la plateforme seulement : un compte membre d'un
        # commerce ne devient pas super-utilisateur, il faudrait d'abord le
        # retirer du commerce (un compte distinct est préférable).
        is_superuser = self.cleaned_data.get("is_superuser")
        if is_superuser and OrganizationMembership.objects.filter(user=self.instance).exists():
            raise forms.ValidationError(
                "Ce compte est membre d'un commerce : créez un compte distinct pour la plateforme."
            )
        return is_superuser

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        membership = _active_membership(self.instance)
        if membership is not None and "role" in self.fields:
            self.fields["role"].initial = membership.role
            self.fields["can_view_costs"].initial = membership.can_view_costs


def _active_membership(user) -> OrganizationMembership | None:
    if user is None or user.pk is None:
        return None
    return OrganizationMembership.objects.filter(user=user, is_active=True).first()


class StoreAssignmentInline(TenantAdminMixin, TabularInline):
    model = StoreAssignment
    fields = ("store", "is_active")
    autocomplete_fields = ("store",)
    extra = 0
    verbose_name = "boutique autorisée"
    verbose_name_plural = "boutiques autorisées"


@admin.register(User)
class UserAdmin(TenantAdminMixin, BaseUserAdmin, ModelAdmin):
    """Les comptes d'un commerce, gérés par son propriétaire.

    Un commerce ne voit que ses membres (jamais un super-utilisateur). Le
    propriétaire crée gérants et caissiers, choisit leur rôle et leur accès
    aux coûts ; les groupes et l'accès à l'administration en découlent
    (`sync_member_access`). Un compte propriétaire ne se modifie que par
    lui-même — sans pouvoir changer son rôle — ou par la plateforme."""

    form = MemberChangeForm
    add_form = MemberCreationForm
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

    def get_queryset(self, request: HttpRequest):
        return super().get_queryset(request).prefetch_related("memberships")

    def get_list_display(self, request: HttpRequest):
        if is_platform_admin(request):
            return super().get_list_display(request)
        return ("username", "first_name", "last_name", "role_display", "is_active")

    @admin.display(description=_("rôle"))
    def role_display(self, obj: User) -> str:
        active = [m for m in obj.memberships.all() if m.is_active]
        return active[0].get_role_display() if active else "—"

    def get_fieldsets(self, request: HttpRequest, obj: User | None = None):
        fieldsets = super().get_fieldsets(request, obj)
        if request.user.is_superuser:
            return fieldsets

        # Un propriétaire gère les comptes de son commerce (créer, désactiver,
        # réinitialiser le mot de passe, choisir le rôle) mais ne peut jamais
        # accorder — à lui-même ou à quiconque — le statut super-utilisateur,
        # un groupe ou une permission Django : le rôle en décide.
        restricted_fields = {"is_staff", "is_superuser", "groups", "user_permissions"}
        fieldsets = tuple(
            (title, {**options, "fields": tuple(
                field for field in options["fields"] if field not in restricted_fields
            )})
            for title, options in fieldsets
        )
        if self._role_is_editable(request, obj):
            fieldsets = (*fieldsets, (_("Rôle dans le commerce"), {"fields": MEMBER_FIELDS}))
        return fieldsets

    def get_form(self, request: HttpRequest, obj=None, **kwargs):
        form = super().get_form(request, obj, **kwargs)
        # Champs déclarés sur le formulaire : présents même hors des
        # fieldsets, ils n'y restent que là où le rôle se modifie.
        if not self._role_is_editable(request, obj):
            for name in MEMBER_FIELDS:
                form.base_fields.pop(name, None)
        return form

    def _role_is_editable(self, request: HttpRequest, obj: User | None) -> bool:
        if is_platform_admin(request):
            return False  # la plateforme passe par la fiche de l'organisation
        if obj is None:
            return True
        membership = _active_membership(obj)
        return (
            obj != request.user
            and membership is not None
            and membership.role != Role.OWNER
        )

    def save_model(self, request: HttpRequest, obj: User, form, change: bool) -> None:
        super().save_model(request, obj, form, change)
        if is_platform_admin(request):
            return

        role = form.cleaned_data.get("role") or Role.CASHIER
        can_view_costs = role == Role.MANAGER and bool(form.cleaned_data.get("can_view_costs"))
        if not change:
            # Créé depuis un commerce : il en est membre, avec le rôle choisi.
            OrganizationMembership.objects.create(
                organization=get_tenant(request).organization,
                user=obj,
                role=role,
                can_view_costs=can_view_costs,
                created_by=request.user,
            )
        elif "role" in form.cleaned_data:
            OrganizationMembership.objects.filter(
                user=obj, is_active=True, organization=get_tenant(request).organization
            ).update(role=role, can_view_costs=can_view_costs)
        sync_member_access(obj)

    def has_change_permission(
        self, request: HttpRequest, obj: User | str | None = None
    ) -> bool:
        if not super().has_change_permission(request, obj):
            return False
        if request.user.is_superuser or obj is None:
            return True

        # Un propriétaire ne doit jamais pouvoir modifier — ni réinitialiser le
        # mot de passe d' — un compte super-utilisateur ou un autre
        # propriétaire. `obj` est soit l'instance (formulaire d'édition
        # standard) soit le pk brut (vérification de permission du bouton
        # "Changer le mot de passe" ci-dessus).
        target = obj if isinstance(obj, User) else User.objects.filter(pk=obj).first()
        if target is None:
            return True
        if target.is_superuser:
            return False
        is_other_owner = target != request.user and OrganizationMembership.objects.filter(
            user=target, is_active=True, role=Role.OWNER
        ).exists()
        return not is_other_owner


@admin.register(Group)
class GroupAdmin(BaseGroupAdmin, ModelAdmin):
    pass
