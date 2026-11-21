# preview-app (moved)

The app now lives in [`studio/`](../studio/README.md). This directory only keeps thin shims so existing commands keep working:

- `node preview-app/serve.mjs` runs `studio/serve.mjs`
- `node preview-app/smoke-test.mjs` runs `studio/smoke-test.mjs`
- `python preview-app/serve.py` runs `studio/serve.py`
- the server still answers every `/preview-app/...` URL as `/studio/...`
