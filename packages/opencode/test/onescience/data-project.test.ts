import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { OneScienceDataProject } from "@/onescience/data-project"
import {
  OneScienceDataAgentRunTable,
  OneScienceDataArtifactTable,
  OneScienceDataProjectTable,
  OneScienceDataQualityReportTable,
  OneScienceDataReleaseTable,
} from "@/onescience/data-project.sql"
import { resetDatabase } from "../fixture/db"

beforeEach(async () => {
  await resetDatabase()
})

afterEach(async () => {
  await resetDatabase()
})

describe("OneScience data project schema", () => {
  test("defines AI Ready data workflow tables", () => {
    expect(OneScienceDataProjectTable.id.name).toBe("id")
    expect(OneScienceDataProjectTable.raw_data_uri.name).toBe("raw_data_uri")
    expect(OneScienceDataProjectTable.target_dataset_goal.name).toBe("target_dataset_goal")
    expect(OneScienceDataAgentRunTable.project_id.name).toBe("project_id")
    expect(OneScienceDataArtifactTable.artifact_type.name).toBe("artifact_type")
    expect(OneScienceDataQualityReportTable.train_ready_score.name).toBe("train_ready_score")
    expect(OneScienceDataReleaseTable.resource_id.name).toBe("resource_id")
  })
})

describe("OneScienceDataProject", () => {
  test("creates and lists raw data intake projects", () => {
    const created = OneScienceDataProject.create({
      title: "ERA5 Raw Intake",
      description: "ERA5 pressure-level weather variables for forecast training.",
      domain: "地球科学",
      rawDataUri: "https://example.org/era5.zarr",
      rawDataFormat: "zarr",
      rawDataLicense: "CC-BY-4.0",
      rawDataMetadataJson: { variables: ["t", "u", "v"] },
      targetDatasetName: "ERA5 AI Ready Forecast Dataset",
      targetDatasetGoal: "用于天气预测模型训练和评估",
      targetTaskType: "forecasting",
    })

    expect(created.status).toBe("draft")
    expect(created.rawDataUri).toBe("https://example.org/era5.zarr")
    expect(OneScienceDataProject.list({ limit: 10 }).items.some((item) => item.id === created.id)).toBe(true)
  })

  test("publishes an AI Ready artifact to OneHub datasets", () => {
    const project = OneScienceDataProject.create({
      title: "Protein Raw Intake",
      description: "Protein sequence corpus for structure model fine-tuning.",
      domain: "生命科学",
      rawDataUri: "https://example.org/protein.fasta",
      rawDataFormat: "fasta",
      rawDataLicense: "research-only",
      targetDatasetName: "Protein AI Ready Dataset",
      targetDatasetGoal: "用于蛋白结构预测模型训练",
      targetTaskType: "generation",
    })
    const artifact = OneScienceDataProject.createArtifact(project.id, {
      artifactType: "ai_ready_dataset",
      title: "Protein AI Ready Dataset v1",
      uri: "file:///data/protein-ai-ready",
      format: "parquet",
      metadataJson: { split: ["train", "valid", "test"] },
      version: "v1",
      qualityScore: 0.91,
    })
    const release = OneScienceDataProject.publishToOneHub(project.id, artifact.id, "acct-data-project")

    expect(release.target).toBe("onehub")
    expect(release.status).toBe("published")
    expect(release.resourceId).toStartWith("custom-datasets-")
    expect(OneScienceDataProject.get(project.id).project.status).toBe("published")
  })

  test("records task reports for reproduction optimization and adaptation", () => {
    const project = OneScienceDataProject.create({
      title: "GraphCast Reproduction",
      description: "Reproduce a scientific model workflow with reports.",
      domain: "地球科学",
      rawDataUri: "https://example.org/era5.zarr",
      rawDataFormat: "zarr",
      targetDatasetName: "ERA5 Reproduction Dataset",
      targetDatasetGoal: "用于论文复现、性能优化和模型适配验证",
      targetTaskType: "paper-reproduction",
    })
    const run = OneScienceDataProject.createAgentRun(project.id, {
      runType: "paper_reproduction",
      inputJson: { taskProfile: "paper-reproduction" },
      planJson: { capabilityFamilies: ["resource.discovery", "training", "report.reproducibility"] },
    })

    const reproduction = OneScienceDataProject.createArtifact(project.id, {
      runId: run.id,
      artifactType: "reproduction_report",
      title: "GraphCast reproduction report",
      format: "markdown",
      metadataJson: { taskProfile: "paper-reproduction" },
    })
    const profile = OneScienceDataProject.createArtifact(project.id, {
      artifactType: "profile_report",
      title: "Inference profile report",
      format: "json",
      metadataJson: { taskProfile: "performance-optimization" },
    })
    const optimization = OneScienceDataProject.createArtifact(project.id, {
      artifactType: "optimization_report",
      title: "Optimization report",
      format: "markdown",
      metadataJson: { baseline: profile.id },
    })
    const adapter = OneScienceDataProject.createArtifact(project.id, {
      artifactType: "adapter_report",
      title: "Adapter validation report",
      format: "markdown",
      metadataJson: { taskProfile: "model-adaptation" },
    })

    const detail = OneScienceDataProject.get(project.id)

    expect(run.runType).toBe("paper_reproduction")
    expect(detail.artifacts.map((item) => item.artifactType)).toEqual(expect.arrayContaining([
      "reproduction_report",
      "profile_report",
      "optimization_report",
      "adapter_report",
    ]))
    expect(reproduction.metadataJson?.taskProfile).toBe("paper-reproduction")
    expect(optimization.metadataJson?.baseline).toBe(profile.id)
    expect(adapter.metadataJson?.taskProfile).toBe("model-adaptation")
  })
})

describe("OneScience data project experimental API", () => {
  test("declares data project workflow endpoints", async () => {
    const source = await Bun.file(new URL("../../src/server/routes/instance/httpapi/groups/experimental.ts", import.meta.url)).text()

    expect(source).toContain('dataProject: "/experimental/onescience/data-project"')
    expect(source).toContain('catalogRawSource: "/experimental/onescience/raw-source"')
    expect(source).toContain('catalogAlready: "/experimental/onescience/already"')
    expect(source).toContain('catalogFsStat: "/experimental/onescience/fs-stat"')
    expect(source).toContain('catalogAlreadyPublish: "/experimental/onescience/already/:id/publish"')
    const handlers = await Bun.file(new URL("../../src/server/routes/instance/httpapi/handlers/experimental.ts", import.meta.url)).text()
    expect(handlers).toContain("requireCatalogAccount")
    expect(handlers).toContain("CatalogGoneError")
    expect(handlers).toContain("OPENCODE_WORKSPACE_ID")
    expect(source).toContain('dataProjectItem: "/experimental/onescience/data-project/:id"')
    expect(source).toContain('dataProjectAnalyze: "/experimental/onescience/data-project/:id/analyze"')
    expect(source).toContain('dataProjectPublish: "/experimental/onescience/data-project/:id/publish"')
  })
})
