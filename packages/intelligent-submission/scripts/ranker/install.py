"""Download fixed ModelScope assets into a private, restartable local installation."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import threading
import time


def emit(phase, message, **fields):
    print('RANKER_PROGRESS ' + json.dumps(dict(phase=phase, message=message, **fields), ensure_ascii=False), flush=True)


def verify_adapter(directory, expected_manifest):
    manifest_path = directory / 'manifest.json'
    if hashlib.sha256(manifest_path.read_bytes()).hexdigest() != expected_manifest:
        raise ValueError('适配器清单校验失败，请重试下载。')
    manifest = json.loads(manifest_path.read_text())
    for name, expected in manifest['files'].items():
        file = (directory / name).resolve()
        if not file.is_relative_to(directory.resolve()):
            raise ValueError('模型清单包含非法路径。')
        if hashlib.sha256(file.read_bytes()).hexdigest() != expected['sha256']:
            raise ValueError('模型文件校验失败：' + name)
    return manifest


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--model', required=True)
    parser.add_argument('--root', required=True)
    parser.add_argument('--catalog', required=True)
    args = parser.parse_args()
    catalog = json.loads(Path(args.catalog).read_text())
    model = catalog[args.model]
    root = Path(args.root).resolve()
    target = root / args.model
    target.mkdir(parents=True, exist_ok=True)
    # Keep all downloads/cache inside the selected installation directory.
    os.environ['MODELSCOPE_CACHE'] = str(root / 'cache')
    from modelscope import snapshot_download
    import torch
    if not torch.cuda.is_available():
        raise RuntimeError('PyTorch 无法使用 NVIDIA CUDA，请更新显卡驱动后重试，或使用系统对话模型。')
    stop = threading.Event()
    def report_bytes():
        while not stop.wait(3):
            total = sum(p.stat().st_size for p in target.rglob('*') if p.is_file())
            emit('downloading', '正在从魔搭下载模型（中断后可重试续传）', downloadedBytes=total)
    thread = threading.Thread(target=report_bytes, daemon=True)
    thread.start()
    try:
        emit('downloading', '正在从魔搭下载基础模型')
        snapshot_download(model['base'], revision=model['baseRevision'], local_dir=str(target / 'base'),
                          allow_patterns=['*.json', '*.safetensors', '*.txt', '*.model', '*.tiktoken', '*.jinja', 'LICENSE*', 'USE_POLICY*'], max_workers=4)
        emit('downloading', '正在下载训练权重、评分头与校准文件')
        snapshot_download(model['adapter'], revision=model['revision'], local_dir=str(target / 'adapter'), max_workers=4)
    finally:
        stop.set()
        thread.join()
    emit('verifying', '正在校验训练权重与校准文件')
    verify_adapter(target / 'adapter', model['manifest'])
    marker = {'model': args.model, 'revision': model['revision'], 'baseRevision': model['baseRevision'], 'manifest': model['manifest']}
    temporary = target / 'installed.json.tmp'
    temporary.write_text(json.dumps(marker))
    temporary.replace(target / 'installed.json')
    emit('installed', '下载与校验完成，正在启动本地推理')


if __name__ == '__main__':
    main()
