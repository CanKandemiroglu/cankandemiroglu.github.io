# Marine Map Tool — PyGMT render container (Phase 3, optional paid path).
#
# NOT DEPLOYED. Build/push to your own registry and run it as a Cloudflare
# Container (or any container host) that consumes the marine-render-jobs queue.
# See render/README.md.
#
# GMT is LGPL: it is invoked here as an external executable via PyGMT, never
# statically linked into the closed-source parts of the product.
FROM condaforge/miniforge3:latest

RUN mamba install -y -c conda-forge pygmt=0.13 gmt=6.5 python=3.12 \
    && mamba clean -afy

WORKDIR /app
COPY render.py /app/render.py

# The worker entrypoint long-polls the queue; RENDER_QUEUE_URL and R2/S3
# credentials are injected as environment variables at deploy time.
ENTRYPOINT ["python", "/app/render.py"]
