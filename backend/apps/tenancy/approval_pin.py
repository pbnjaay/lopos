"""Le gérant ou le propriétaire choisit lui-même son code PIN de validation
(jamais quelqu'un d'autre : il valide en son nom sur le poste des caissiers)."""

from django import forms
from django.contrib import messages
from django.core.exceptions import PermissionDenied
from django.http import HttpRequest, HttpResponse
from django.shortcuts import redirect, render
from django.urls import reverse
from unfold.widgets import UnfoldAdminPasswordWidget

from .context import get_tenant
from .models import OrganizationMembership

Role = OrganizationMembership.Role

# Codes trop faciles à deviner en regardant le clavier.
_WEAK_PINS = {"0000", "1111", "1234", "2222", "3333", "4444", "5555", "6666",
              "7777", "8888", "9999", "4321", "123456", "654321", "000000", "111111"}


class ApprovalPinForm(forms.Form):
    current_password = forms.CharField(
        label="Votre mot de passe",
        strip=False,
        widget=UnfoldAdminPasswordWidget(attrs={"autocomplete": "current-password"}),
    )
    pin = forms.RegexField(
        label="Nouveau code PIN",
        regex=r"^\d{4,6}$",
        error_messages={"invalid": "Le code PIN fait 4 à 6 chiffres."},
        widget=UnfoldAdminPasswordWidget(attrs={"inputmode": "numeric", "autocomplete": "off"}),
    )
    pin_confirmation = forms.CharField(
        label="Confirmez le code PIN",
        widget=UnfoldAdminPasswordWidget(attrs={"inputmode": "numeric", "autocomplete": "off"}),
    )

    def __init__(self, *args, user, **kwargs):
        super().__init__(*args, **kwargs)
        self.user = user

    def clean_current_password(self):
        password = self.cleaned_data["current_password"]
        if not self.user.check_password(password):
            raise forms.ValidationError("Mot de passe incorrect.")
        return password

    def clean_pin(self):
        pin = self.cleaned_data["pin"]
        if pin in _WEAK_PINS:
            raise forms.ValidationError("Ce code PIN est trop facile à deviner.")
        return pin

    def clean(self):
        cleaned = super().clean()
        if cleaned.get("pin") and cleaned.get("pin") != cleaned.get("pin_confirmation"):
            self.add_error("pin_confirmation", "Les deux codes PIN ne correspondent pas.")
        return cleaned


def approval_pin_view(request: HttpRequest, admin_site) -> HttpResponse:
    tenant = get_tenant(request)
    if tenant is None or tenant.role not in (Role.OWNER, Role.MANAGER):
        raise PermissionDenied
    membership = tenant.membership
    form = ApprovalPinForm(request.POST or None, user=request.user)
    if request.method == "POST" and form.is_valid():
        membership.set_approval_pin(form.cleaned_data["pin"])
        membership.save(update_fields=["approval_pin", "updated_at"])
        messages.success(request, "Votre code PIN de validation est enregistré.")
        return redirect(reverse("admin:index"))

    context = {
        **admin_site.each_context(request),
        "title": "Mon code PIN de validation",
        "form": form,
        "has_pin": bool(membership.approval_pin),
        "back_url": reverse("admin:index"),
    }
    return render(request, "admin/tenancy/approval_pin.html", context)
