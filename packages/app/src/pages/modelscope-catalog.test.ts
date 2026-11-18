import { describe, expect, test } from "bun:test"
import {
  modelScopeCacheFollowup,
  modelScopeDatasetId,
  modelScopeDatasetPageUrl,
  modelScopeDatasetRelativePath,
  modelScopeDatasets,
  modelScopeDownloadDatasetCommand,
  modelScopeDownloadModelCommand,
  modelScopeModelDownloadMethod,
  modelScopeModelId,
  modelScopeModelRelativePath,
} from "./modelscope-catalog"

describe("modelscope catalog", () => {
  test("resolves model library titles to modelscope model ids", () => {
    expect(modelScopeModelId("FengWu")).toBe("OneScience/FengWu")
    expect(modelScopeModelId("FuXi")).toBe("OneScience/FuXi")
    expect(modelScopeModelId("FourCastNet")).toBe("OneScience/FourCastNet")
    expect(modelScopeModelId("FourCastNet_v2")).toBe("OneScience/FourCastNet_v2")
    expect(modelScopeModelId("FuXi_v21")).toBe("OneScience/FuXi_v21")
    expect(modelScopeModelId("OneForecast")).toBe("OneScience/OneForecast")
    expect(modelScopeModelId("StormCast")).toBe("OneScience/StormCast")
    expect(modelScopeModelId("GlobalSurgeML")).toBe("OneScience/GlobalSurgeML")
    expect(modelScopeModelId("FireCubeNet")).toBe("OneScience/FireCubeNet")
    expect(modelScopeModelId("WoFS-StormCal")).toBe("OneScience/WoFS-StormCal")
    expect(modelScopeModelId("ClimateBench")).toBe("OneScience/ClimateBench")
    expect(modelScopeModelId("CausalModelEvaluation")).toBe("OneScience/CausalModelEvaluation")
    expect(modelScopeModelId("Mattergen")).toBe("OneScience/Mattergen")
    expect(modelScopeModelId("Equiformer_v3")).toBe("OneScience/Equiformer_v3")
    expect(modelScopeModelId("eSEN")).toBe("OneScience/eSEN")
    expect(modelScopeModelId("NequIP")).toBe("OneScience/NequIP")
    expect(modelScopeModelId("Nequix")).toBeUndefined()
    expect(modelScopeModelId("GFNO")).toBe("OneScience/GFNO")
    expect(modelScopeModelId("GraphCast")).toBe("OneScience/GraphCast")
    expect(modelScopeModelId("OpenFold")).toBe("OneScience/OpenFold")
    expect(modelScopeModelId("AlphaFold3")).toBe("OneScience/AlphaFold3")
    expect(modelScopeModelId("ProteinMPNN")).toBe("OneScience/ProteinMPNN")
    expect(modelScopeModelId("DeePMD")).toBe("OneScience/DeePMD")
    expect(modelScopeModelId("FNO")).toBe("OneScience/FNO")
    expect(modelScopeModelId("CorrDiff")).toBe("OneScience/CorrDiff")
    expect(modelScopeModelId("KNO")).toBe("OneScience/KNO")
    expect(modelScopeModelId("MatterSim")).toBeUndefined()
    expect(modelScopeModelId("Mattersim")).toBe("OneScience/Mattersim")
    expect(modelScopeModelId("AlphaGenome")).toBeUndefined()
    expect(modelScopeModelId("alphagenome")).toBe("OneScience/alphagenome")
    expect(modelScopeModelId("Protenix")).toBeUndefined()
    expect(modelScopeModelId("protenix")).toBe("OneScience/protenix")
    expect(modelScopeModelId("Evo2")).toBeUndefined()
    expect(modelScopeModelId("evo2")).toBe("OneScience/evo2")
    expect(modelScopeModelId("AURORA")).toBe("OneScience/AURORA")
    expect(modelScopeModelId("NowcastNet_Earth")).toBe("OneScience/NowcastNet_Earth")
    expect(modelScopeModelId("Pangu-weather")).toBe("OneScience/Pangu-weather")
    expect(modelScopeModelId("RFdiffusion")).toBe("OneScience/RFdiffusion")
    expect(modelScopeModelId("GenScore")).toBe("OneScience/GenScore")
    expect(modelScopeModelId("DiffDock")).toBe("OneScience/DiffDock")
    expect(modelScopeModelId("TargetDiff")).toBe("OneScience/TargetDiff")
    expect(modelScopeModelId("Medgemma")).toBe("OneScience/Medgemma")
    expect(modelScopeModelId("CFDBench")).toBe("OneScience/CFDBench")
    expect(modelScopeModelId("MeshGraphNet")).toBe("OneScience/MeshGraphNet")
    expect(modelScopeModelId("PDENNEval")).toBe("OneScience/PDENNEval")
    expect(modelScopeModelId("GP_for_TO")).toBe("OneScience/GP_for_TO")
    expect(modelScopeModelId("ESM")).toBe("OneScience/ESM")
    expect(modelScopeModelId("ESM-2")).toBeUndefined()
    expect(modelScopeModelId("Transolver-Airfoil-Design")).toBe("OneScience/Transolver-Airfoil-Design")
    expect(modelScopeModelId("Transolver-Car-Design")).toBe("OneScience/Transolver-Car-Design")
    expect(modelScopeModelId("Transolver")).toBeUndefined()
    expect(modelScopeModelId("Transolver++")).toBeUndefined()
  })

  test("maps dataset cards to modelscope dataset ids", () => {
    expect(Object.keys(modelScopeDatasets)).toHaveLength(37)
    expect(Object.values(modelScopeDatasets)).toContain("OneScience/DeePMD")
    expect(Object.values(modelScopeDatasets)).toContain("OneScience/mmseqsDB")
    expect(Object.values(modelScopeDatasets)).toContain("OneScience/RPB_CNO")
    expect(Object.values(modelScopeDatasets)).toContain("OneScience/FNO")
    expect(Object.values(modelScopeDatasets)).toContain("OneScience/pointnet_cfd")
  })

  test("resolves dataset card ids to modelscope dataset ids", () => {
    expect(modelScopeDatasetId("material-oc20")).toBe("OneScience/oc20")
    expect(modelScopeDatasetId("seed-datasets-material-oc20")).toBe("OneScience/oc20")
    expect(modelScopeDatasetId("life-ms-mmseqsdb")).toBe("OneScience/mmseqsDB")
    expect(modelScopeDatasetId("earth-era5")).toBe("OneScience/ERA5")
    expect(modelScopeDatasetId("fluid-cfdbench")).toBe("OneScience/cfdbench")
    expect(modelScopeDatasetId("fluid-rpb-cno")).toBe("OneScience/RPB_CNO")
    expect(modelScopeDatasetId("fluid-fno")).toBe("OneScience/FNO")
    expect(modelScopeDatasetId("fluid-pointnet-cfd")).toBe("OneScience/pointnet_cfd")
    expect(modelScopeDatasetId("fluid-beno")).toBe("OneScience/beno")
    expect(modelScopeDatasetId("fluid-deepmind-cylinder-flow")).toBe("OneScience/cylinder_flow")
    expect(modelScopeDatasetId("material-ms-pbe")).toBe("OneScience/pbe_pbesol_phonon")
    expect(modelScopeDatasetId("life-ms-evo2")).toBe("OneScience/evo2_dataset")
    expect(modelScopeDatasetId("life-ms-alphafold3")).toBe("OneScience/AlphaFold3_dataset")
    expect(modelScopeDatasetId("life-ms-protenix")).toBe("OneScience/protenix_dataset")
    expect(modelScopeDatasetId("life-ms-esm2")).toBe("OneScience/esmfold_dataset")
    expect(modelScopeDatasetId("material-alexandria")).toBeUndefined()
    expect(modelScopeDatasetPageUrl("OneScience/beno")).toBe("https://modelscope.cn/datasets/OneScience/beno")
  })

  test("builds download commands and project-relative paths", () => {
    expect(modelScopeDownloadModelCommand("OneScience/FengWu")).toBe(
      "modelscope download --model OneScience/FengWu --cache_dir modelscope/hub/models",
    )
    expect(modelScopeDownloadDatasetCommand("OneScience/DeePMD")).toBe(
      "modelscope download --dataset OneScience/DeePMD --cache_dir modelscope/hub/datasets",
    )
    expect(modelScopeCacheFollowup("modelscope/hub/models")).toContain("modelscope 实际创建的目录为准")
    expect(modelScopeCacheFollowup("modelscope/hub/models")).not.toContain("OneScience/")
    expect(modelScopeModelRelativePath("OneScience/FengWu")).toBe("modelscope/hub/models/OneScience/FengWu")
    expect(modelScopeDatasetRelativePath("OneScience/DeePMD")).toBe("modelscope/hub/datasets/OneScience/DeePMD")
    expect(modelScopeModelDownloadMethod("FengWu")).toBe(
      "modelscope download --model OneScience/FengWu --cache_dir modelscope/hub/models",
    )
    expect(modelScopeModelDownloadMethod("Unknown Model")).toBeUndefined()
  })
})
