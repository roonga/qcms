# syntax=docker/dockerfile:1

# Keep Grafana Labs' development stack intact and add only version-controlled
# QCMS dashboard provisioning. A wrapper image is used instead of bind mounts:
# the supported dev-container workflow talks to the host Docker daemon, where the
# repository's container-side path does not exist (ADR-29).
ARG QCMS_LGTM_IMAGE=grafana/otel-lgtm:latest
FROM ${QCMS_LGTM_IMAGE}

COPY docker/grafana/dashboards.yaml /otel-lgtm/grafana/conf/provisioning/dashboards/qcms.yaml
COPY docker/grafana/qcms-observability.json /otel-lgtm/grafana/conf/provisioning/dashboards/qcms/qcms-observability.json
