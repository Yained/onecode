/** Map authored scenario model labels onto onemodel card ids (capability resource id). */
const MODEL_CARD_ALIASES: Record<string, string> = {
  mace: "mace",
  mattersim: "material_mattersim",
  mattergen: "material_mattergen",
  nequip: "material_nequip",
  uma: "material_uma",
  deepmd: "deepmd",
  alphafold: "alphafold",
  alphafold3: "alphafold3",
  alphagenome: "alphagenome",
  diffdock: "diffdock",
  esm: "esm",
  evo2: "evo2",
  genscore: "genscore",
  laproteina: "laproteina",
  "la-proteina": "laproteina",
  medgemma: "medgemma",
  molsculptor: "molsculptor",
  openfold: "openfold",
  proteinmpnn: "proteinmpnn",
  protenix: "protenix",
  rfdiffusion: "rfdiffusion",
  simplefold: "simplefold",
  targetdiff: "targetdiff",
  "pt-dit": "pt_dit",
  ptdit: "pt_dit",
  pt_dit: "pt_dit",
  state: "life_state",
  deeponet: "deeponet",
  "inverse deeponet": "deeponet",
  inversedeeponet: "deeponet",
  meshgraphnet: "meshgraphnet",
  "mesh transformer": "fluid_eagle_mesh_transformer",
  meshtransformer: "fluid_eagle_mesh_transformer",
  eaglemshtransformer: "fluid_eagle_mesh_transformer",
  eaglemeshtransformer: "fluid_eagle_mesh_transformer",
  "fourier neural operator": "fno",
  fourierneuraloperator: "fno",
  fno: "fno",
  "factorized fno": "f_fno",
  factorizedfno: "f_fno",
  "factorized fourier neural operator": "fluid_factorized_fourier_neural_operator",
  factorizedfourierneuraloperator: "fluid_factorized_fourier_neural_operator",
  f_fno: "f_fno",
  ffno: "f_fno",
  transolver: "transolver",
  "u-net": "u_net",
  unet: "u_net",
  u_net: "u_net",
  transformer: "transformer",
  "transformer surrogate": "transformer",
  transformersurrogate: "transformer",
  "transformer aerodynamic surrogate": "transformer",
  transformeraerodynamicsurrogate: "transformer",
  "pde transformer": "transformer",
  pdetransformer: "transformer",
  "universal physics transformer": "fluid_universal_physics_transformers",
  universalphysicstransformer: "fluid_universal_physics_transformers",
  "universal physics transformers": "fluid_universal_physics_transformers",
  "point-cloud regressor": "pointnet",
  pointcloudregressor: "pointnet",
  "point-cloud network": "pointnet",
  pointcloudnetwork: "pointnet",
  pointnet: "pointnet",
  pointnetcfd: "pointnet",
  "wavelet neural operator": "mwt",
  waveletneuraloperator: "mwt",
  mwt: "mwt",
  "boundary-embedded neural operator": "BE_MPNN",
  boundaryembeddedneuraloperator: "BE_MPNN",
  "be-mpnn": "BE_MPNN",
  be_mpnn: "BE_MPNN",
  bemppn: "BE_MPNN",
  "message-passing neural pde solver": "fluid_mp_pde",
  messagepassingneuralpdesolver: "fluid_mp_pde",
  mp_pde: "fluid_mp_pde",
  mppde: "fluid_mp_pde",
  "equivariant neural operator": "gfno",
  equivariantneuraloperator: "gfno",
  gfno: "gfno",
  "graph neural operator": "gnot",
  graphneuraloperator: "gnot",
  gnot: "gnot",
  "graph neural network": "graphsage",
  graphneuralnetwork: "graphsage",
  graphsage: "graphsage",
}

function normalizeModelKey(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "")
}

function resolveOneModelCardId(name: string) {
  const trimmed = name.trim()
  if (!trimmed || /^null$/i.test(trimmed)) return undefined
  if (/[\u4e00-\u9fff]/.test(trimmed) && trimmed.length > 12) return undefined

  const compact = normalizeModelKey(trimmed)
  const spaced = trimmed.toLowerCase().replace(/\s+/g, " ").trim()
  const dashed = trimmed.toLowerCase().replace(/\s+/g, "-").trim()
  return (
    MODEL_CARD_ALIASES[compact] ??
    MODEL_CARD_ALIASES[spaced] ??
    MODEL_CARD_ALIASES[dashed] ??
    MODEL_CARD_ALIASES[trimmed.toLowerCase()] ??
    (compact.length ? trimmed.toLowerCase().replace(/\s+/g, "_").replace(/[^a-z0-9_-]+/g, "") : undefined)
  )
}

/** Card ids for models with parallel is_onemodel[i] === true. */
export function resolveScenarioModelIds(input: {
  model: string[]
  is_onemodel: boolean[]
  model_ids?: string[]
  name?: string
}) {
  if (input.model_ids?.length) return input.model_ids.map(String)

  const parts = input.model.map(String).map((part) => part.trim()).filter(Boolean)
  if (!parts.length) return []
  if (parts.length === 1 && parts[0] === String(input.name ?? "").trim()) return []

  const ids: string[] = []
  const seen = new Set<string>()
  for (const [index, part] of parts.entries()) {
    if (!input.is_onemodel[index]) continue
    const id = resolveOneModelCardId(part)
    if (!id || seen.has(id)) continue
    seen.add(id)
    ids.push(id)
  }
  return ids
}

export function formatScenarioModelLabel(model: string[]) {
  return model
    .map(String)
    .map((part) => part.trim())
    .filter((part) => part && !/^null$/i.test(part))
    .join(", ")
}
