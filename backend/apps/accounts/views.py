from django.contrib.auth import authenticate, login, logout
from django.utils.decorators import method_decorator
from django.views.decorators.csrf import csrf_protect, ensure_csrf_cookie
from rest_framework import status
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.tenancy.context import TenantDenial, denial_reason, get_tenant, resolve_tenant

from . import login_guard

from .serializers import CurrentUserSerializer, LoginSerializer


@method_decorator(ensure_csrf_cookie, name="dispatch")
class CsrfCookieView(APIView):
    authentication_classes = ()
    permission_classes = (AllowAny,)

    def get(self, request) -> Response:
        return Response({"detail": "CSRF cookie set"}, status=status.HTTP_200_OK)


@method_decorator(csrf_protect, name="dispatch")
class LoginView(APIView):
    authentication_classes = ()
    permission_classes = (AllowAny,)

    def post(self, request) -> Response:
        serializer = LoginSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        username = serializer.validated_data["username"]

        blocked = login_guard.check(request, username)
        if blocked is not None:
            return Response(
                {"code": "TOO_MANY_LOGIN_ATTEMPTS", "message": login_guard.BLOCKED_MESSAGE},
                status=status.HTTP_429_TOO_MANY_REQUESTS,
                headers={"Retry-After": str(blocked.retry_after)},
            )

        user = authenticate(
            request=request,
            username=username,
            password=serializer.validated_data["password"],
        )
        if user is None:
            login_guard.record_failure(request, username)
            return Response(
                {
                    "code": "INVALID_CREDENTIALS",
                    "message": "Nom d'utilisateur ou mot de passe incorrect.",
                },
                status=status.HTTP_401_UNAUTHORIZED,
            )

        login_guard.record_success(request, username)

        # Pas de session pour un compte qui n'appartient à aucun commerce actif
        # (super-utilisateur de la plateforme compris) : refusé avant `login`.
        tenant = resolve_tenant(user)
        if tenant is None:
            code = denial_reason(user)
            return Response(
                {"code": code, "message": TenantDenial.MESSAGES[code]},
                status=status.HTTP_403_FORBIDDEN,
            )

        login(request, user)
        return Response(
            CurrentUserSerializer(user, context={"tenant": tenant}).data,
            status=status.HTTP_200_OK,
        )


@method_decorator(csrf_protect, name="dispatch")
class LogoutView(APIView):
    # Un compte retiré de son commerce doit encore pouvoir se déconnecter.
    permission_classes = (IsAuthenticated,)

    def post(self, request) -> Response:
        logout(request)
        return Response({"detail": "Logged out"}, status=status.HTTP_200_OK)


class MeView(APIView):
    def get(self, request) -> Response:
        return Response(
            CurrentUserSerializer(
                request.user, context={"tenant": get_tenant(request)}
            ).data,
            status=status.HTTP_200_OK,
        )
