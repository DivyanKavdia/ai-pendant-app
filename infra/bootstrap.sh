#!/usr/bin/env bash
#
# One-time bootstrap for a brand new GCP project.
#
# Solves the chicken-and-egg problem: Terraform wants to create a Cloud Run
# service, Cloud Run wants an image, and the image needs somewhere to live. This
# enables just enough of GCP to build and push a first image, then prints the
# tag for `terraform apply`.
#
# Run this once. After that, ./infra/deploy.sh handles every subsequent deploy.
#
#   PROJECT_ID=my-project ./infra/bootstrap.sh
#
set -euo pipefail

PROJECT_ID="${PROJECT_ID:?Set PROJECT_ID to your GCP project id}"
REGION="${REGION:-asia-south1}"
REPO="${REPO:-synap}"
TAG="${TAG:-bootstrap-$(date +%Y%m%d%H%M%S)}"
IMAGE="${REGION}-docker.pkg.dev/${PROJECT_ID}/${REPO}/backend:${TAG}"

here="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

echo "==> Project ${PROJECT_ID}, region ${REGION}"
gcloud config set project "${PROJECT_ID}" >/dev/null

echo "==> Confirming billing is linked"
# Almost every first-run failure is an unlinked billing account, and the error
# it produces three steps later names an unrelated API. Fail here instead.
if ! gcloud beta billing projects describe "${PROJECT_ID}" \
      --format='value(billingEnabled)' 2>/dev/null | grep -qi true; then
  echo "ERROR: no billing account is linked to ${PROJECT_ID}." >&2
  echo "Link one: https://console.cloud.google.com/billing/linkedaccount?project=${PROJECT_ID}" >&2
  exit 1
fi

echo "==> Enabling the APIs needed to build and push"
gcloud services enable \
  cloudresourcemanager.googleapis.com \
  serviceusage.googleapis.com \
  artifactregistry.googleapis.com \
  cloudbuild.googleapis.com \
  run.googleapis.com \
  --project="${PROJECT_ID}"

echo "==> Creating the Artifact Registry repository"
gcloud artifacts repositories describe "${REPO}" \
  --location="${REGION}" --project="${PROJECT_ID}" >/dev/null 2>&1 || \
gcloud artifacts repositories create "${REPO}" \
  --repository-format=docker \
  --location="${REGION}" \
  --project="${PROJECT_ID}" \
  --description="Synap backend images"

echo "==> Verifying the build before it can reach a registry"
( cd "${here}/backend" && npm ci && npm test )

echo "==> Building ${IMAGE}"
gcloud builds submit "${here}/backend" --tag "${IMAGE}" --project="${PROJECT_ID}"

cat <<EOT

Bootstrap complete.

Next, provision everything else in one pass:

  cd infra/terraform
  terraform init
  terraform apply \\
    -var project_id=${PROJECT_ID} \\
    -var region=${REGION} \\
    -var google_client_id=YOUR_CLIENT_ID.apps.googleusercontent.com \\
    -var image=${IMAGE}

Then add your Gemini AI Studio key and pin the service URL:

  printf '%s' "YOUR_GEMINI_API_KEY" | \\
    gcloud secrets versions add synap-gemini-api-key --data-file=- --project=${PROJECT_ID}

  URL=\$(gcloud run services describe synap-backend --region=${REGION} \\
    --project=${PROJECT_ID} --format='value(status.url)')
  gcloud run services update synap-backend --region=${REGION} \\
    --project=${PROJECT_ID} --update-env-vars="SYNAP_SERVICE_URL=\$URL"
  echo "\$URL"

EOT
