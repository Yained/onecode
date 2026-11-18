#!/usr/bin/env python3
"""Print a short text preview for common scientific binary formats."""

from __future__ import annotations

import json
import sys


def main() -> int:
    if len(sys.argv) < 3:
        print("usage: sample_scientific.py <format> <path>", file=sys.stderr)
        return 2
    fmt = sys.argv[1].lower().lstrip(".")
    path = sys.argv[2]
    max_lines = int(sys.argv[3]) if len(sys.argv) > 3 else 80
    try:
        text = sample(fmt, path, max_lines)
    except Exception as exc:  # noqa: BLE001 - surface to caller as empty preview
        print(f"preview_error: {exc}", file=sys.stderr)
        return 1
    if not text:
        return 1
    sys.stdout.write(text)
    if not text.endswith("\n"):
        sys.stdout.write("\n")
    return 0


def sample(fmt: str, path: str, max_lines: int) -> str:
    if fmt in {"nc", "nc4", "cdf", "netcdf"}:
        return sample_netcdf(path, max_lines)
    if fmt in {"h5", "hdf5", "hdf", "he5"}:
        return sample_hdf5(path, max_lines)
    if fmt in {"npy", "npz"}:
        return sample_numpy(path, max_lines)
    if fmt == "mat":
        return sample_mat(path, max_lines)
    raise ValueError(f"unsupported format: {fmt}")


def sample_netcdf(path: str, max_lines: int) -> str:
    import netCDF4 as nc

    ds = nc.Dataset(path)
    lines = [f"netcdf: {path}", f"format: {getattr(ds, 'file_format', 'unknown')}"]
    dims = {name: int(dim.size) for name, dim in ds.dimensions.items()}
    lines.append(f"dimensions: {json.dumps(dims, ensure_ascii=False)}")
    lines.append("variables:")
    for name, var in list(ds.variables.items())[: max_lines - 4]:
        dims_s = ",".join(var.dimensions)
        lines.append(f"  {name}: shape={tuple(var.shape)} dtype={var.dtype} dims=({dims_s})")
    if len(ds.variables) > max_lines - 4:
        lines.append(f"  … ({len(ds.variables) - (max_lines - 4)} more variables)")
    attrs = {key: _short(ds.getncattr(key)) for key in list(ds.ncattrs())[:12]}
    if attrs:
        lines.append(f"global_attrs: {json.dumps(attrs, ensure_ascii=False)}")
    ds.close()
    return "\n".join(lines[:max_lines])


def sample_hdf5(path: str, max_lines: int) -> str:
    import h5py

    lines = [f"hdf5: {path}"]
    count = 0

    def walk(group: "h5py.Group", prefix: str = "") -> None:
        nonlocal count
        for key in group.keys():
            if count >= max_lines - 1:
                return
            node = group[key]
            name = f"{prefix}/{key}" if prefix else key
            if isinstance(node, h5py.Dataset):
                lines.append(f"  {name}: shape={node.shape} dtype={node.dtype}")
                count += 1
            else:
                lines.append(f"  {name}/")
                count += 1
                walk(node, name)

    with h5py.File(path, "r") as handle:
        walk(handle)
        if count >= max_lines - 1:
            lines.append("  …")
    return "\n".join(lines[:max_lines])


def sample_numpy(path: str, max_lines: int) -> str:
    import numpy as np

    lines: list[str] = []
    if path.lower().endswith(".npz"):
        data = np.load(path, allow_pickle=False)
        lines.append(f"npz arrays: {len(data.files)}")
        for name in data.files[: max_lines - 1]:
            arr = data[name]
            lines.append(f"  {name}: shape={arr.shape} dtype={arr.dtype}")
            flat = _flat_preview(arr)
            if flat:
                lines.append(f"    sample: {flat}")
        if len(data.files) > max_lines - 1:
            lines.append(f"  … ({len(data.files) - (max_lines - 1)} more)")
        return "\n".join(lines[:max_lines])

    arr = np.load(path, allow_pickle=False)
    lines.append(f"npy: shape={arr.shape} dtype={arr.dtype}")
    flat = _flat_preview(arr)
    if flat:
        lines.append(f"sample: {flat}")
    return "\n".join(lines[:max_lines])


def sample_mat(path: str, max_lines: int) -> str:
    import scipy.io as sio

    data = sio.loadmat(path, squeeze_me=True, struct_as_record=False)
    keys = [key for key in data.keys() if not key.startswith("__")]
    lines = [f"mat variables: {len(keys)}"]
    for key in keys[: max_lines - 1]:
        value = data[key]
        shape = getattr(value, "shape", None)
        dtype = getattr(value, "dtype", type(value).__name__)
        lines.append(f"  {key}: shape={shape} dtype={dtype}")
    if len(keys) > max_lines - 1:
        lines.append(f"  … ({len(keys) - (max_lines - 1)} more)")
    return "\n".join(lines[:max_lines])


def _flat_preview(arr, limit: int = 12) -> str:
    import numpy as np

    if getattr(arr, "size", 0) == 0:
        return ""
    flat = np.asarray(arr).reshape(-1)[:limit]
    return np.array2string(flat, separator=", ")


def _short(value, limit: int = 80) -> str:
    text = str(value)
    return text if len(text) <= limit else text[: limit - 1] + "…"


if __name__ == "__main__":
    raise SystemExit(main())
