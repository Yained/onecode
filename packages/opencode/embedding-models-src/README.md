# Embedding model source for CI / release builds

`build.ts --bundle-embedding` copies a local Xenova model into `dist/onecode-linux-x64/embedding-models/`.

Provide the flat model directory (must contain `onnx/model.onnx`) via one of:

1. **Jenkins / CI (recommended on this server)** — set before `bun run pack:standalone`:

   ```bash
   export CATALOG_EMBEDDING_SRC=/data/onecode/Xenova/bge-small-zh-v1.5
   export CATALOG_EMBEDDING_MODEL=Xenova/bge-small-zh-v1.5
   ```

   `oneci/onecode-pack/run_pack_standalone.sh` exports these by default.

2. **HF cache layout** — if the model is already in hub cache:

   ```bash
   export CATALOG_EMBEDDING_CACHE=$HOME/.local/share/opencode/embedding-models
   ```

3. **Repo-local copy** — place files at:

   ```text
   packages/opencode/embedding-models-src/Xenova/bge-small-zh-v1.5/onnx/model.onnx
   ```

4. **One-off build flag**:

   ```bash
   bun ./script/build.ts --single --skip-install --bundle-embedding \
     --embedding-src=/data/onecode/Xenova/bge-small-zh-v1.5
   ```

The packed tgz ships `embedding-models/` when built with `--bundle-embedding`; runtime `serve.sh` sets `CATALOG_EMBEDDING_CACHE` to that directory automatically.
