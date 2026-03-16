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

required_vars="GOOGLE_CLOUD_PROJECT CLOUD_RUN_REGION CLOUD_RUN_SERVICE LLM_API_KEY"

for var_name in $required_vars; do
  eval "value=\${$var_name:-}"
  if [ -z "$value" ]; then
    echo "Missing required environment variable: $var_name" >&2
    exit 1
  fi
done

if [ "${YOUTUBE_UPLOAD_MOCK:-true}" != "true" ]; then
  oauth_required_vars="GOOGLE_CLIENT_ID GOOGLE_CLIENT_SECRET"
  for var_name in $oauth_required_vars; do
    eval "value=\${$var_name:-}"
    if [ -z "$value" ]; then
      echo "Missing required environment variable for live YouTube uploads: $var_name" >&2
      exit 1
    fi
  done
fi

tmp_env_file="$(mktemp)"
trap 'rm -f "$tmp_env_file"' EXIT

deploy_app_base_url="${APP_BASE_URL:-}"
if is_local_url "$deploy_app_base_url"; then
  deploy_app_base_url=""
fi

deploy_redirect_uri="${GOOGLE_REDIRECT_URI:-}"
if is_local_url "$deploy_redirect_uri"; then
  deploy_redirect_uri=""
fi

cat > "$tmp_env_file" <<EOF
DATABASE_URL: "file:./dev.db"
LLM_API_KEY: "${LLM_API_KEY}"
LLM_MODEL: "${LLM_MODEL:-gemini-2.5-pro}"
LLM_MODEL_HARD: "${LLM_MODEL_HARD:-gemini-3.1-pro-preview}"
LLM_IMAGE_MODEL: "${LLM_IMAGE_MODEL:-gemini-3.1-flash-image-preview}"
LLM_VIDEO_MODEL: "${LLM_VIDEO_MODEL:-veo-3.1-fast-generate-preview}"
LLM_TTS_MODEL: "${LLM_TTS_MODEL:-gemini-2.5-pro-preview-tts}"
LLM_TTS_VOICE: "${LLM_TTS_VOICE:-Kore}"
LLM_BASE_URL: "${LLM_BASE_URL:-https://generativelanguage.googleapis.com/v1beta/openai}"
ENABLE_MULTIMODAL_STORYBOARD_ANALYSIS: "${ENABLE_MULTIMODAL_STORYBOARD_ANALYSIS:-true}"
ENABLE_GENERATED_SUPPORT_MEDIA: "${ENABLE_GENERATED_SUPPORT_MEDIA:-true}"
GENERATED_SUPPORT_MEDIA_MODE: "${GENERATED_SUPPORT_MEDIA_MODE:-video}"
RENDER_ENABLE_GENERATED_NARRATION: "${RENDER_ENABLE_GENERATED_NARRATION:-true}"
RUN_RENDER_JOBS_INLINE: "${RUN_RENDER_JOBS_INLINE:-true}"
YOUTUBE_UPLOAD_MOCK: "${YOUTUBE_UPLOAD_MOCK:-true}"
EOF

if [ -n "${GOOGLE_CLIENT_ID:-}" ]; then
  printf 'GOOGLE_CLIENT_ID: "%s"\n' "$GOOGLE_CLIENT_ID" >> "$tmp_env_file"
fi

if [ -n "${GOOGLE_CLIENT_SECRET:-}" ]; then
  printf 'GOOGLE_CLIENT_SECRET: "%s"\n' "$GOOGLE_CLIENT_SECRET" >> "$tmp_env_file"
fi

if [ -n "$deploy_app_base_url" ]; then
  printf 'APP_BASE_URL: "%s"\n' "$deploy_app_base_url" >> "$tmp_env_file"
fi

if [ -n "$deploy_redirect_uri" ]; then
  printf 'GOOGLE_REDIRECT_URI: "%s"\n' "$deploy_redirect_uri" >> "$tmp_env_file"
fi

gcloud run deploy "$CLOUD_RUN_SERVICE" \
  --quiet \
  --source . \
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
  --env-vars-file "$tmp_env_file"

service_url="$(gcloud run services describe "$CLOUD_RUN_SERVICE" \
  --project "$GOOGLE_CLOUD_PROJECT" \
  --region "$CLOUD_RUN_REGION" \
  --format 'value(status.url)')"

resolved_app_base_url="${APP_BASE_URL:-}"
if [ -z "$resolved_app_base_url" ] || is_local_url "$resolved_app_base_url"; then
  resolved_app_base_url="$service_url"
fi

resolved_redirect_uri="${GOOGLE_REDIRECT_URI:-}"
if [ -n "$resolved_redirect_uri" ] && is_local_url "$resolved_redirect_uri"; then
  resolved_redirect_uri=""
fi

if [ -z "$resolved_redirect_uri" ] && [ -n "${GOOGLE_CLIENT_ID:-}" ] && [ -n "${GOOGLE_CLIENT_SECRET:-}" ]; then
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
