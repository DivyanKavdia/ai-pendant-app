#!/usr/bin/env bash
#
# Build, push and deploy the Synap backend.
#
# Terraform owns the infrastructure; this script owns the image. Run Terraform
# first (see docs/GCP_DEPLOYMENT.md), then use this for every subsequent deploy.
#
#   PROJECT_ID=my-project ./infra/deploy.sh
#
set -euo pipefail

PROJECT_ID="${PROJECT_ID:?Set PROJECT_ID}"
REGION="${REGION:-asia-south1}"
REPO="${REPO:-synap}"
SERVICE="${SERVICE:-synap-backend}"
TAG="${TAG:-$(git rev-parse --short HEAD 2>/dev/null || date +%Y%m%d%H%M%S)}"
IMAGE="${REGION}-docker.pkg.dev/${PROJECT_ID}/${REPO}/backend:${TAG}"

here="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

echo "==> Verifying the build before it can reach production"
( cd "${here}/backend" && npm ci && npm test )

echo "==> Ensuring the Artifact Registry repository exists"
gcloud artifacts repositories describe "${REPO}" \
  --location="${REGION}" --project="${PROJECT_ID}" >/dev/null 2>&1 || \
gcloud artifacts repositories create "${REPO}" \
  --repository-format=docker --location="${REGION}" --project="${PROJECT_ID}" \
  --description="Synap backend images"

echo "==> Building ${IMAGE}"
gcloud builds submit "${here}/backend" --tag "${IMAGE}" --project="${PROJECT_ID}"

echo "==> Deploying ${SERVICE}"
gcloud run deploy "${SERVICE}" \
  --image="${IMAGE}" \
  --region="${REGION}" \
  --project="${PROJECT_ID}" \
  --quiet

url="$(gcloud run services describe "${SERVICE}" --region="${REGION}" \
  --project="${PROJECT_ID}" --format='value(status.url)')"

# The service needs to know its own URL to enqueue Cloud Tasks that call back
# into it, and that URL only exists after the first deploy.
echo "==> Pinning SYNAP_SERVICE_URL=${url}"
gcloud run services update "${SERVICE}" \
  --region="${REGION}" --project="${PROJECT_ID}" \
  --update-env-vars="SYNAP_SERVICE_URL=${url}" --quiet

echo "==> Health check"
curl -fsS "${url}/health" && echo

echo
echo "Deployed: ${url}"
echo "Set this as the backend URL in the PWA (Settings, or SYNAP_BACKEND_URL in synap-backend.js)."
