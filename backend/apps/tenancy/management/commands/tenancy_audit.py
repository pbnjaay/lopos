from datetime import timedelta

from django.contrib.auth import get_user_model
from django.core.management.base import BaseCommand
from django.db.models import Count, Q
from django.utils import timezone

from apps.stores.models import Store
from apps.sync.models import ProcessedSyncEvent
from apps.tenancy.models import Organization, OrganizationMembership

User = get_user_model()


class Command(BaseCommand):
    help = (
        "Lecture seule : état du rattachement des données et des comptes aux "
        "organisations. À lancer après la migration multi-organisation, avant "
        "de promouvoir un propriétaire ou d'accueillir un second commerce."
    )

    def add_arguments(self, parser) -> None:
        parser.add_argument(
            "--days",
            type=int,
            default=90,
            help="Fenêtre d'activité caisse prise en compte (défaut : 90 jours).",
        )

    def handle(self, *args, **options) -> None:
        since = timezone.now() - timedelta(days=options["days"])
        warnings: list[str] = []

        self._organizations(warnings)
        self._stores()
        self._unattached(warnings)
        self._accounts(since, options["days"], warnings)

        self._title("Points d'attention")
        if not warnings:
            self.stdout.write(self.style.SUCCESS("  Aucun."))
        for warning in warnings:
            self.stdout.write(self.style.WARNING(f"  ! {warning}"))

    def _title(self, title: str) -> None:
        self.stdout.write(f"\n== {title} ==")

    def _organizations(self, warnings: list[str]) -> None:
        self._title("Organisations")
        organizations = Organization.objects.annotate(
            store_count=Count("stores", distinct=True),
            owner_count=Count(
                "memberships",
                filter=Q(memberships__is_active=True, memberships__role="OWNER"),
                distinct=True,
            ),
            member_count=Count(
                "memberships", filter=Q(memberships__is_active=True), distinct=True
            ),
        )
        if not organizations:
            self.stdout.write("  Aucune.")
        for organization in organizations:
            self.stdout.write(
                f"  {organization.name} [{organization.slug}] "
                f"{organization.get_status_display()} — "
                f"{organization.store_count} magasin(s), "
                f"{organization.member_count} membre(s) actif(s), "
                f"{organization.owner_count} propriétaire(s)"
            )
            if organization.owner_count == 0:
                warnings.append(
                    f"« {organization.name} » n'a aucun propriétaire : en promouvoir un "
                    "explicitement (Organisations › membres)."
                )

    def _stores(self) -> None:
        self._title("Magasins")
        stores = Store.objects.select_related("organization").annotate(
            register_count=Count("cash_registers", distinct=True),
            assigned_count=Count(
                "user_assignments",
                filter=Q(user_assignments__is_active=True),
                distinct=True,
            ),
        )
        if not stores:
            self.stdout.write("  Aucun.")
        for store in stores:
            self.stdout.write(
                f"  {store.name} ({'actif' if store.is_active else 'inactif'}) — "
                f"organisation : {store.organization or '—'}, "
                f"{store.register_count} caisse(s), "
                f"{store.assigned_count} compte(s) affecté(s)"
            )

    def _unattached(self, warnings: list[str]) -> None:
        # Magasins, produits et catégories ont toujours un commerce (colonne
        # obligatoire) ; seul un événement de sync dont la vente a disparu
        # peut rester sans magasin.
        self._title("Données sans organisation")
        counts = {
            "événements de synchronisation sans magasin": (
                ProcessedSyncEvent.objects.filter(store__isnull=True).count()
            ),
        }
        for label, count in counts.items():
            self.stdout.write(f"  {label} : {count}")
            if count:
                warnings.append(f"{count} {label} à rattacher.")

    def _accounts(self, since, days: int, warnings: list[str]) -> None:
        self._title(f"Comptes (activité caisse sur {days} jours)")
        users = (
            User.objects.prefetch_related(
                "groups",
                "memberships__organization",
                "store_assignments__store",
            )
            .annotate(
                recent_sales=Count(
                    "sales", filter=Q(sales__created_at__gte=since), distinct=True
                ),
                recent_sessions=Count(
                    "cash_sessions",
                    filter=Q(cash_sessions__opened_at__gte=since),
                    distinct=True,
                ),
            )
            .order_by("username")
        )
        for user in users:
            memberships = list(user.memberships.all())
            assignments = [a for a in user.store_assignments.all() if a.is_active]
            flags = [
                "actif" if user.is_active else "inactif",
                *(["super-utilisateur"] if user.is_superuser else []),
                *(["staff"] if user.is_staff else []),
            ]
            membership_label = ", ".join(
                f"{m.organization.slug}:{m.get_role_display()}"
                + ("" if m.is_active else " (inactif)")
                + (" +coûts" if m.can_view_costs else "")
                for m in memberships
            ) or "—"
            last_login = (
                f"{timezone.localtime(user.last_login):%d/%m/%Y}"
                if user.last_login
                else "jamais"
            )
            self.stdout.write(
                f"  {user.username} [{' · '.join(flags)}] "
                f"groupes : {', '.join(g.name for g in user.groups.all()) or '—'} | "
                f"magasins : {', '.join(a.store.name for a in assignments) or '—'} | "
                f"membre : {membership_label} | "
                f"{user.recent_sales} vente(s), {user.recent_sessions} session(s) | "
                f"dernière connexion : {last_login}"
            )
            self._account_warnings(user, memberships, assignments, warnings)

    def _account_warnings(self, user, memberships, assignments, warnings) -> None:
        active_memberships = [m for m in memberships if m.is_active]
        if user.is_superuser:
            if user.recent_sales or user.recent_sessions:
                warnings.append(
                    f"{user.username} est super-utilisateur et vend en caisse : lui "
                    "créer un compte distinct dans l'organisation (le super-utilisateur "
                    "n'aura plus accès à la caisse)."
                )
            if memberships:
                warnings.append(
                    f"{user.username} est super-utilisateur et membre d'un commerce : "
                    "retirer ce rattachement (la plateforme n'est membre d'aucun commerce)."
                )
            return
        if not active_memberships:
            if user.is_active:
                warnings.append(f"{user.username} n'appartient à aucune organisation.")
            return
        membership = active_memberships[0]
        if not user.is_active:
            warnings.append(
                f"{user.username} est désactivé mais reste membre actif de "
                f"« {membership.organization.name} »."
            )
        if membership.role != OrganizationMembership.Role.OWNER and not assignments:
            warnings.append(
                f"{user.username} n'est affecté à aucun magasin : il ne pourra pas "
                "ouvrir de caisse."
            )
        foreign = [
            a.store.name
            for a in assignments
            if a.store.organization_id != membership.organization_id
        ]
        if foreign:
            warnings.append(
                f"{user.username} est affecté à un magasin d'une autre organisation : "
                f"{', '.join(foreign)}."
            )
