import { spawnSync } from "child_process"
import { readFileSync } from "fs"
import path from "path"

export const TEXT_SAMPLE_FORMATS = [
  // tables / docs
  "csv",
  "tsv",
  "txt",
  "md",
  "rst",
  "log",
  "yaml",
  "yml",
  "xml",
  "html",
  "htm",
  "json",
  "jsonl",
  "ndjson",
  // bio sequences / annotations
  "fasta",
  "fa",
  "fna",
  "faa",
  "fastq",
  "fq",
  "sam",
  "vcf",
  "bed",
  "gff",
  "gff3",
  "gtf",
  "gb",
  "gbk",
  "genbank",
  "embl",
  // structures / chemistry
  "pdb",
  "cif",
  "mmcif",
  "mol",
  "sdf",
  "mol2",
  "smi",
  "xyz",
  "extxyz",
  // misc scientific text
  "vtk",
  "bib",
  "tex",
  "cml",
] as const

export const PYTHON_SAMPLE_FORMATS = [
  "nc",
  "nc4",
  "cdf",
  "netcdf",
  "h5",
  "hdf5",
  "hdf",
  "he5",
  "npy",
  "npz",
  "mat",
] as const

export const SPECIAL_SAMPLE_FORMATS = ["xlsx", "pdf"] as const

export const SAMPLEABLE_FORMATS = [
  ...TEXT_SAMPLE_FORMATS,
  ...PYTHON_SAMPLE_FORMATS,
  ...SPECIAL_SAMPLE_FORMATS,
] as const

export function isSampleableFormat(format: string) {
  return (SAMPLEABLE_FORMATS as readonly string[]).includes(format)
}

export function sampleTextFile(filePath: string, maxBytes: number) {
  return readFileSync(filePath).subarray(0, maxBytes).toString("utf8")
}

/** Summarize NetCDF / HDF5 / NumPy / MATLAB files via the local Python scientific stack. */
export function sampleScientificBinary(filePath: string, format: string, maxBytes = 64 * 1024) {
  if (!(PYTHON_SAMPLE_FORMATS as readonly string[]).includes(format)) return
  const script = path.join(import.meta.dir, "sample-scientific.py")
  try {
    const result = spawnSync("python3", [script, format, filePath, "80"], {
      encoding: "utf8",
      maxBuffer: maxBytes * 2,
      timeout: 12_000,
    })
    if (result.status !== 0) return
    const text = result.stdout?.trim()
    if (!text) return
    return text.length > maxBytes ? `${text.slice(0, maxBytes)}\n…` : text
  } catch {
    return
  }
}
