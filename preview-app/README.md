# preview-app (moved)

The studio lives in [`studio/`](../studio/README.md) and the first project's own pages in [`playables/`](../playables/README.md). This directory only keeps thin shims so existing commands keep working:

- `node preview-app/serve.mjs` runs `studio/serve.mjs`
- `node preview-app/smoke-test.mjs` runs `playables/smoke-test.mjs`
- `python preview-app/serve.py` runs `playables/serve.py`
- the server still answers every `/preview-app/...` URL as `/studio/...`
