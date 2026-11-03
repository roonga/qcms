# syntax=docker/dockerfile:1

# The host daemon cannot resolve dev-container bind paths; copy provisioning files into the image.
ARG QCMS_LGTM_IMAGE=grafana/otel-lgtm:latest
FROM ${QCMS_LGTM_IMAGE}

COPY docker/grafana/dashboards.yaml /otel-lgtm/grafana/conf/provisioning/dashboards/qcms.yaml
COPY docker/grafana/qcms-observability.json /otel-lgtm/grafana/conf/provisioning/dashboards/qcms/qcms-observability.json
