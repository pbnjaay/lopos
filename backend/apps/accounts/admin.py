from django.contrib import admin
from django.contrib.auth.admin import GroupAdmin as BaseGroupAdmin
from django.contrib.auth.admin import UserAdmin as BaseUserAdmin
from django.contrib.auth.models import Group, User
from unfold.admin import ModelAdmin, TabularInline
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


@admin.register(Group)
class GroupAdmin(BaseGroupAdmin, ModelAdmin):
    pass
