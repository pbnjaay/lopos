from django import template

from apps.dashboard.formatting import format_fcfa

register = template.Library()


@register.filter(name="fcfa")
def fcfa(value):
    return format_fcfa(value)
