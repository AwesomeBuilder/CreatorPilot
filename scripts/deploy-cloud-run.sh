#!/bin/sh
set -eu

export CLOUDSDK_CORE_DISABLE_FILE_LOGGING="${CLOUDSDK_CORE_DISABLE_FILE_LOGGING:-1}"

is_local_url() {
  case "${1:-}" in
    http://localhost* | https://localhost* | http://127.0.0.1* | https://127.0.0.1*)
      return 0
      ;;
    *)
      return 1
      ;;
  esac
}

required_vars="GOOGLE_CLOUD_PROJECT CLOUD_RUN_REGION CLOUD_RUN_SERVICE"

for var_name in $required_vars; do
  eval "value=\${$var_name:-}"
  if [ -z "$value" ]; then
    echo "Missing required environment variable: $var_name" >&2
    exit 1
  fi
done

if ! command -v python3 >/dev/null 2>&1; then
  echo "python3 is required to build the Cloud Run environment manifest." >&2
  exit 1
fi

tmp_env_file="$(mktemp)"
current_service_json="$(mktemp)"
trap 'rm -f "$tmp_env_file" "$current_service_json"' EXIT

service_exists=0
if gcloud run services describe "$CLOUD_RUN_SERVICE" \
  --project "$GOOGLE_CLOUD_PROJECT" \
  --region "$CLOUD_RUN_REGION" \
  --format 'json(spec.template.spec.containers[0].env,status.url)' > "$current_service_json" 2>/dev/null; then
  service_exists=1
else
  : > "$current_service_json"
fi

get_service_env() {
  if [ "$service_exists" -ne 1 ]; then
    return 0
  fi

  python3 - "$current_service_json" "$1" <<'PY'
import json
import sys

service_json_path, env_name = sys.argv[1], sys.argv[2]

with open(service_json_path, "r", encoding="utf-8") as handle:
    payload = json.load(handle)

for item in payload.get("spec", {}).get("template", {}).get("spec", {}).get("containers", [{}])[0].get("env", []):
    if item.get("name") == env_name:
        print(item.get("value", ""), end="")
        break
PY
}

resolve_explicit_or_service() {
  var_name="$1"
  eval "value=\${$var_name:-}"
  if [ -z "$value" ]; then
    value="$(get_service_env "$var_name")"
  fi
  printf '%s' "$value"
}

python3 - "$current_service_json" "$tmp_env_file" <<'PY'
import json
import os
import sys

service_json_path, output_path = sys.argv[1], sys.argv[2]

defaults = {
    "DATABASE_URL": "file:./dev.db",
    "LLM_MODEL": "gemini-2.5-pro",
    "LLM_MODEL_HARD": "gemini-3.1-pro-preview",
    "LLM_IMAGE_MODEL": "gemini-3.1-flash-image-preview",
    "LLM_VIDEO_MODEL": "veo-3.1-fast-generate-preview",
    "LLM_TTS_MODEL": "gemini-2.5-pro-preview-tts",
    "LLM_TTS_FALLBACK_MODEL": "gemini-2.5-flash-preview-tts",
    "LLM_TTS_VOICE": "Kore",
    "LLM_BASE_URL": "https://generativelanguage.googleapis.com/v1beta/openai",
    "ENABLE_MULTIMODAL_STORYBOARD_ANALYSIS": "true",
    "ENABLE_GENERATED_SUPPORT_MEDIA": "true",
    "GENERATED_SUPPORT_MEDIA_MODE": "video",
    "RENDER_ENABLE_GENERATED_NARRATION": "true",
    "RUN_RENDER_JOBS_INLINE": "false",
    "YOUTUBE_UPLOAD_MOCK": "true",
}

ordered_keys = [
    "DATABASE_URL",
    "LLM_API_KEY",
    "LLM_MODEL",
    "LLM_MODEL_HARD",
    "LLM_IMAGE_MODEL",
    "LLM_VIDEO_MODEL",
    "LLM_TTS_MODEL",
    "LLM_TTS_FALLBACK_MODEL",
    "LLM_TTS_VOICE",
    "LLM_BASE_URL",
    "ENABLE_MULTIMODAL_STORYBOARD_ANALYSIS",
    "ENABLE_GENERATED_SUPPORT_MEDIA",
    "GENERATED_SUPPORT_MEDIA_MODE",
    "RENDER_ENABLE_GENERATED_NARRATION",
    "RUN_RENDER_JOBS_INLINE",
    "RENDER_STORAGE_BUCKET",
    "MEDIA_STORAGE_BUCKET",
    "YOUTUBE_UPLOAD_MOCK",
    "GOOGLE_CLIENT_ID",
    "GOOGLE_CLIENT_SECRET",
    "APP_BASE_URL",
    "GOOGLE_REDIRECT_URI",
]

env_map = {}
if os.path.getsize(service_json_path) > 0:
    with open(service_json_path, "r", encoding="utf-8") as handle:
        payload = json.load(handle)
    for item in payload.get("spec", {}).get("template", {}).get("spec", {}).get("containers", [{}])[0].get("env", []):
        name = item.get("name")
        if name:
            env_map[name] = item.get("value", "")

for key in ordered_keys:
    explicit_value = os.environ.get(key, "")
    if explicit_value:
        env_map[key] = explicit_value
    elif key not in env_map and key in defaults:
        env_map[key] = defaults[key]

if not env_map.get("LLM_API_KEY"):
    print("Missing required environment variable: LLM_API_KEY", file=sys.stderr)
    sys.exit(1)

if env_map.get("YOUTUBE_UPLOAD_MOCK", "true") != "true":
    for key in ("GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"):
        if not env_map.get(key):
            print(
                f"Missing required environment variable for live YouTube uploads: {key}",
                file=sys.stderr,
            )
            sys.exit(1)

extra_keys = sorted(key for key in env_map if key not in ordered_keys)
write_order = ordered_keys + extra_keys

with open(output_path, "w", encoding="utf-8") as handle:
    for key in write_order:
        if key not in env_map:
            continue
        handle.write(f"{key}: {json.dumps(env_map[key])}\n")
PY

deploy_app_base_url="$(resolve_explicit_or_service APP_BASE_URL)"
if is_local_url "$deploy_app_base_url"; then
  deploy_app_base_url=""
fi

deploy_redirect_uri="$(resolve_explicit_or_service GOOGLE_REDIRECT_URI)"
if is_local_url "$deploy_redirect_uri"; then
  deploy_redirect_uri=""
fi

resolved_google_client_id="$(resolve_explicit_or_service GOOGLE_CLIENT_ID)"
resolved_google_client_secret="$(resolve_explicit_or_service GOOGLE_CLIENT_SECRET)"

if [ -n "${CLOUD_RUN_IMAGE:-}" ]; then
  gcloud run deploy "$CLOUD_RUN_SERVICE" \
    --quiet \
    --project "$GOOGLE_CLOUD_PROJECT" \
    --region "$CLOUD_RUN_REGION" \
    --platform managed \
    --allow-unauthenticated \
    --port 8080 \
    --cpu 2 \
    --memory 2Gi \
    --timeout 900 \
    --concurrency 1 \
    --min-instances 1 \
    --max-instances 1 \
    --no-cpu-throttling \
    --image "$CLOUD_RUN_IMAGE" \
    --env-vars-file "$tmp_env_file"
else
  gcloud run deploy "$CLOUD_RUN_SERVICE" \
    --quiet \
    --project "$GOOGLE_CLOUD_PROJECT" \
    --region "$CLOUD_RUN_REGION" \
    --platform managed \
    --allow-unauthenticated \
    --port 8080 \
    --cpu 2 \
    --memory 2Gi \
    --timeout 900 \
    --concurrency 1 \
    --min-instances 1 \
    --max-instances 1 \
    --no-cpu-throttling \
    --source . \
    --env-vars-file "$tmp_env_file"
fi

service_url="$(gcloud run services describe "$CLOUD_RUN_SERVICE" \
  --project "$GOOGLE_CLOUD_PROJECT" \
  --region "$CLOUD_RUN_REGION" \
  --format 'value(status.url)')"

resolved_app_base_url="$deploy_app_base_url"
if [ -z "$resolved_app_base_url" ]; then
  resolved_app_base_url="$service_url"
fi

resolved_redirect_uri="$deploy_redirect_uri"
if [ -z "$resolved_redirect_uri" ] && [ -n "$resolved_google_client_id" ] && [ -n "$resolved_google_client_secret" ]; then
  resolved_redirect_uri="${resolved_app_base_url}/api/youtube/callback"
fi

update_env_vars="APP_BASE_URL=${resolved_app_base_url}"
if [ -n "$resolved_redirect_uri" ]; then
  update_env_vars="${update_env_vars},GOOGLE_REDIRECT_URI=${resolved_redirect_uri}"
fi

gcloud run services update "$CLOUD_RUN_SERVICE" \
  --quiet \
  --project "$GOOGLE_CLOUD_PROJECT" \
  --region "$CLOUD_RUN_REGION" \
  --update-env-vars "$update_env_vars"

printf 'Cloud Run URL: %s\n' "$service_url"
printf 'Health check: %s/api/health\n' "$service_url"
