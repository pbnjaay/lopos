from unittest.mock import patch

from django.test import override_settings

from apps.observability import posthog_client


@override_settings(POSTHOG_ENABLED=False, POSTHOG_API_KEY="test-key")
def test_capture_is_noop_when_disabled():
    posthog_client._initialized = False
    with patch("posthog.capture") as mock_capture:
        posthog_client.capture("user-1", "product_created", {"product_id": "abc"})
    mock_capture.assert_not_called()


@override_settings(POSTHOG_ENABLED=True, POSTHOG_API_KEY="")
def test_capture_is_noop_when_api_key_missing():
    posthog_client._initialized = False
    with patch("posthog.capture") as mock_capture:
        posthog_client.capture("user-1", "product_created", {"product_id": "abc"})
    mock_capture.assert_not_called()


@override_settings(
    POSTHOG_ENABLED=True, POSTHOG_API_KEY="test-key", POSTHOG_HOST="https://example.test"
)
def test_capture_sends_event_when_enabled():
    posthog_client._initialized = False
    with patch("posthog.capture") as mock_capture:
        posthog_client.capture("user-1", "product_created", {"product_id": "abc"})
    mock_capture.assert_called_once_with(
        "product_created", distinct_id="user-1", properties={"product_id": "abc"}
    )
