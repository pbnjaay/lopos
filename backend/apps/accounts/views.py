from django.contrib.auth import authenticate, login, logout
from django.utils.decorators import method_decorator
from django.views.decorators.csrf import csrf_protect, ensure_csrf_cookie
from rest_framework import status
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView

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

        user = authenticate(
            request=request,
            username=serializer.validated_data["username"],
            password=serializer.validated_data["password"],
        )
        if user is None:
            return Response(
                {
                    "code": "INVALID_CREDENTIALS",
                    "message": "Nom d'utilisateur ou mot de passe incorrect.",
                },
                status=status.HTTP_401_UNAUTHORIZED,
            )

        login(request, user)
        return Response(CurrentUserSerializer(user).data, status=status.HTTP_200_OK)


@method_decorator(csrf_protect, name="dispatch")
class LogoutView(APIView):
    def post(self, request) -> Response:
        logout(request)
        return Response({"detail": "Logged out"}, status=status.HTTP_200_OK)


class MeView(APIView):
    def get(self, request) -> Response:
        return Response(
            CurrentUserSerializer(request.user).data,
            status=status.HTTP_200_OK,
        )
