#!/bin/sh
set -eu

if [ "$#" -ne 2 ]; then
  echo "Usage: $0 <bucket-name> <app-origin>" >&2
  echo "Example: $0 creator-pilot-media https://creator-pilot-abc-uc.a.run.app" >&2
  exit 1
fi

bucket_name="$1"
app_origin="$2"
tmp_cors_file="$(mktemp)"
trap 'rm -f "$tmp_cors_file"' EXIT

cat > "$tmp_cors_file" <<EOF
[
  {
    "origin": ["${app_origin}"],
    "method": ["GET", "HEAD", "POST", "PUT"],
    "responseHeader": [
      "Content-Type",
      "Content-Length",
      "Content-Range",
      "Range",
      "X-Goog-Resumable"
    ],
    "maxAgeSeconds": 3600
  }
]
EOF

gcloud storage buckets update "gs://${bucket_name}" --cors-file="$tmp_cors_file"

printf 'Applied media upload CORS for %s to gs://%s\n' "$app_origin" "$bucket_name"
