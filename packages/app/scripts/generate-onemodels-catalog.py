from pathlib import Path
import json, re
from collections import defaultdict

ASSETS = Path("/home/zhangjing8/oneskills/skills/onescience-primitives/assets")
OUT = Path("/home/zhangjing8/onecode/packages/app/src/workbench/capabilities/onemodels.generated.ts")
GITEE = "https://gitee.com/onescience-ai/onescience/tree/main"

DOCS = {
  "matris": "examples/matchem/matris",
  "uma_escn_md": "examples/matchem/uma",
  "uma_escn_moe": "examples/matchem/uma",
  "fengwu": "examples/earth/fengwu",
  "fourcastnet": "examples/earth/fourcastnet",
  "fuxi": "examples/earth/fuxi",
  "graphcast": "examples/earth/graphcast",
  "nowcastnet": "examples/earth/nowcastnet",
  "pangu": "examples/earth/pangu_weather",
  "xihe": "examples/earth/xihe",
  "BE_MPNN": "examples/cfd/BENO",
  "deeponet": "src/onescience/models/cfd_benchmark/DeepONet.py",
  "f_fno": "src/onescience/models/cfd_benchmark/F_FNO.py",
  "factformer": "src/onescience/models/factformer",
  "fno": "src/onescience/models/cfd_benchmark/FNO.py",
  "galerkin_transformer": "src/onescience/models/cfd_benchmark/Galerkin_Transformer.py",
  "gfno": "src/onescience/models/cfd_benchmark/GFNO.py",
  "gnot": "src/onescience/models/cfd_benchmark/GNOT.py",
  "graphViT": "src/onescience/models/graphvit",
  "graph_unet": "src/onescience/models/cfd_benchmark/Graph_UNet.py",
  "graphsage": "src/onescience/models/cfd_benchmark/GraphSAGE.py",
  "lsm": "src/onescience/models/cfd_benchmark/LSM.py",
  "meshgraphnet": "examples/cfd/MeshGraphNet",
  "mwt": "src/onescience/models/cfd_benchmark/MWT.py",
  "ono": "src/onescience/models/cfd_benchmark/ONO.py",
  "pointnet": "src/onescience/models/cfd_benchmark/PointNet.py",
  "regdgcnn": "src/onescience/models/cfd_benchmark/RegDGCNN.py",
  "swin_transformer": "src/onescience/models/cfd_benchmark/Swin_Transformer.py",
  "transformer": "examples/cfd/EagleMeshTransformer",
  "transolver": "examples/cfd/Transolver-Car-Design",
  "u_fno": "src/onescience/models/cfd_benchmark/U_FNO.py",
  "u_net": "src/onescience/models/cfd_benchmark/U_Net.py",
  "u_no": "src/onescience/models/cfd_benchmark/U_NO.py",
  "alphafold": "examples/biosciences/alphafold",
  "alphafold3": "examples/biosciences/alphafold3",
  "alphagenome": "examples/biosciences/alphagenome",
  "diffdock": "examples/biosciences/diffdock",
  "esm": "examples/biosciences/esm",
  "evo2": "examples/biosciences/evo2",
  "genscore": "examples/biosciences/genscore",
  "laproteina": "examples/biosciences/laproteina",
  "medgemma": "examples/biosciences/medgemma",
  "molsculptor": "examples/biosciences/molsculptor",
  "openfold": "examples/biosciences/openfold",
  "proteinmpnn": "examples/biosciences/ProteinMPNN",
  "protenix": "examples/biosciences/protenix",
  "protoken": "src/onescience/flax_models/protoken",
  "pt_dit": "examples/biosciences/pt_dit",
  "rfdiffusion": "examples/biosciences/RFdiffusion",
  "simplefold": "examples/biosciences/simplefold",
  "targetdiff": "examples/biosciences/targetdiff",
}

DISPLAY = {
  "matris": "MatRIS", "uma_escn_md": "UMA-eSCN-MD", "uma_escn_moe": "UMA-eSCN-MoE",
  "fengwu": "FengWu", "fourcastnet": "FourCastNet", "fuxi": "FuXi",
  "graphcast": "GraphCast", "nowcastnet": "NowcastNet_Earth", "pangu": "Pangu-weather", "xihe": "Xihe",
  "BE_MPNN": "BE-MPNN", "deeponet": "DeepONet", "f_fno": "F-FNO", "factformer": "FactFormer",
  "fno": "FNO", "galerkin_transformer": "Galerkin Transformer", "gfno": "GFNO", "gnot": "GNOT",
  "graphViT": "GraphViT", "graph_unet": "Graph U-Net", "graphsage": "GraphSAGE", "lsm": "LSM",
  "meshgraphnet": "MeshGraphNet", "mwt": "MWT", "ono": "ONO", "pointnet": "PointNetCFD",
  "regdgcnn": "RegDGCNN", "swin_transformer": "Swin Transformer", "transformer": "Transformer",
  "transolver": "Transolver-Airfoil-Design", "u_fno": "U-FNO", "u_net": "U-Net", "u_no": "UNO",
  "alphafold": "AlphaFold", "alphafold3": "AlphaFold3", "alphagenome": "AlphaGenome",
  "diffdock": "DiffDock", "esm": "ESM", "evo2": "Evo2", "genscore": "GenScore",
  "laproteina": "LaProteina", "medgemma": "MedGemma", "molsculptor": "MolSculptor",
  "openfold": "OpenFold", "proteinmpnn": "ProteinMPNN", "protenix": "Protenix",
  "protoken": "ProToken", "pt_dit": "PT-DiT", "rfdiffusion": "RFdiffusion",
  "simplefold": "SimpleFold", "targetdiff": "TargetDiff",
}

DOMAIN_META = {
  "matchem": ("materials", "材料化学", "研究对象 / 材料体系", "例如：CuO、水体系、界面结构", "例如：AIMD 轨迹、POSCAR、能量力标签", "例如：远程 GPU / 单卡冒烟 / HPC 队列"),
  "climate": ("weather", "气象", "预报对象 / 区域", "例如：全球大气、区域降水、海洋涡旋", "例如：ERA5 场、归一化统计量、预训练权重", "例如：远程 GPU / 多卡推理"),
  "cfd": ("fluid", "流体", "研究对象 / 流场场景", "例如：翼型、汽车外流、管道、Darcy", "例如：网格场、点云、图结构数据", "例如：远程 GPU / CFD Benchmark"),
  "bio": ("bio", "生信", "研究对象 / 生物体系", "例如：蛋白序列、复合物、配体口袋", "例如：FASTA、PDB、MSA、配体文件", "例如：远程 GPU / 生物信息流水线"),
}

MODEL_FLOWS = {
  "matris": {
    "suited": ["能量力应力预测", "磁矩预测", "结构优化", "ASE 分子动力学"],
    "notFor": ["无结构输入", "缺少可用权重", "只做电子结构"],
    "prepare": ["CIF/POSCAR 结构", "任务类型 e/ef/efs/m", "预训练权重"],
    "obtain": ["能量/力/应力/磁矩", "优化轨迹", "ASE 结果"],
    "steps": ["准备结构与任务类型", "加载 MatRIS 权重", "小结构冒烟", "正式推理或优化", "接入 ASE/MD"],
    "scenarios": [
      ("predict-efs", "预测能量力应力", "对晶体/分子结构预测能量、力和应力", "MatRIS 物理量预测", "task=e/ef/efs、cutoff、守恒力", "单卡 GPU；小结构可 CPU", "e/f/s 预测与检查报告", ["结构文件", "任务类型"], "预测结果与检查报告", "请用 MatRIS 完成能量/力/应力预测，核对输出字段并给出可用性结论。"),
      ("magmom", "预测磁矩性质", "在支持磁矩的任务头上评估原子磁矩", "MatRIS 磁矩预测", "task 含 m、MagmomHead、元素覆盖", "GPU 推荐", "磁矩预测与异常原子列表", ["结构", "含磁矩任务配置"], "磁矩结果与异常列表", "请配置 MatRIS 磁矩任务并输出逐原子磁矩与异常检查。"),
      ("relax", "结构优化评估", "用 MatRIS calculator 做结构弛豫并检查收敛", "MatRIS 结构优化", "fmax、步数、优化器、周期性", "GPU；先短弛豫冒烟", "优化结构、力收敛曲线", ["初始结构", "优化判据"], "优化结果与收敛报告", "请用 MatRIS/ASE 做结构优化，检查力收敛并输出最终结构。"),
      ("ase-md", "接入 ASE 动力学", "把 MatRIS 接到 ASE calculator 做短时程 MD", "MatRIS ASE/MD 部署", "温度、步长、ensemble", "GPU；短时程 smoke test", "MD 轨迹与能量曲线", ["可用 MatRIS 模型", "初始结构"], "轨迹、能量曲线、脚本", "请把 MatRIS 接入 ASE 做短 MD smoke test，并给出正式运行建议。"),
    ],
  },
  "uma_escn_md": {
    "suited": ["通用材料势推理", "E/F/S 预测", "结构弛豫", "多数据集微调"],
    "notFor": ["无原子构型", "checkpoint 与 dataset 不一致", "非材料任务"],
    "prepare": ["原子结构与邻域图", "charge/spin/dataset", "UMA checkpoint"],
    "obtain": ["能量力应力", "弛豫结构", "评估误差"],
    "steps": ["核对 dataset 与权重同源", "加载 eSCNMD backbone", "E/F/S 冒烟", "评估误差", "弛豫或 MD 部署"],
    "scenarios": [
      ("efs-infer", "通用势函数推理", "用 UMA-eSCN-MD 对多元素体系做 E/F/S 推理", "UMA-eSCN-MD 推理", "cutoff、max_neighbors、head/task、dataset_list", "远程 GPU", "E/F/S 与日志", ["结构", "同源 checkpoint"], "预测结果与日志", "请加载 UMA eSCNMD backbone 完成推理，并核对 head/task 与 dataset 配置。"),
      ("finetune", "微调 UMA backbone", "在目标材料数据上微调 eSCNMD backbone", "微调 UMA-eSCN-MD", "lr、batch、elem_refs、normalizer", "多卡 GPU 可选", "checkpoint 与误差曲线", ["标注数据", "基础权重"], "微调权重与误差", "请按 UMA Hydra 配置微调 eSCNMD，先冒烟再正式训练。"),
      ("evaluate", "评估能量力误差", "在测试集上评估能量、力和应力误差", "评估 UMA-eSCN-MD", "MAE/RMSE、分体系评估", "GPU", "误差表与结论", ["测试集", "checkpoint"], "误差表与可用性结论", "请评估 UMA-eSCN-MD 的 E/F/S 误差，并判断能否进入弛豫/MD。"),
      ("relax-md", "结构弛豫与 MD", "用预测力做结构弛豫或短 MD", "UMA 弛豫/MD", "优化器、温度、步长", "GPU；短任务验证", "弛豫/MD 轨迹", ["结构", "可用模型"], "轨迹与脚本", "请基于 UMA-eSCN-MD 做弛豫或短 MD，并输出稳定性检查。"),
    ],
  },
  "uma_escn_moe": {
    "suited": ["MoE 材料势", "多域联合建模", "专家路由推理", "E/F/S 预测"],
    "notFor": ["无原子构型", "专家配置与权重不匹配", "单域小任务过度配置"],
    "prepare": ["多域结构数据", "MoE 路由配置", "专家权重"],
    "obtain": ["E/F/S 预测", "专家激活统计", "评估报告"],
    "steps": ["确认 MoE 与任务头", "加载专家权重", "路由冒烟", "多域评估", "部署目标域任务"],
    "scenarios": [
      ("moe-infer", "MoE 势函数推理", "用 eSCN MoE backbone 做多专家材料势推理", "UMA-eSCN-MoE 推理", "专家数、路由、dataset/task", "远程 GPU", "预测与专家激活", ["结构", "MoE checkpoint"], "预测结果与激活统计", "请运行 UMA MoE 推理，记录专家激活并核对输出物理量。"),
      ("multi-domain", "多域联合预测", "在 OC/OMAT/分子等多域设置下联合预测", "多域 UMA-MoE 预测", "domain/dataset 列表、归一化", "GPU", "分域预测与对比表", ["多域样本", "权重"], "分域结果表", "请在多域样本上跑 UMA-MoE，并输出分域误差对比。"),
      ("evaluate", "评估专家贡献", "分析专家路由与预测误差关系", "评估 UMA-MoE", "路由统计、分专家误差", "GPU", "专家贡献报告", ["测试集", "checkpoint"], "贡献报告与结论", "请评估 MoE 路由与误差，给出专家是否失衡的结论。"),
      ("deploy", "部署目标域任务", "把 MoE 模型部署到指定材料域任务", "部署 UMA-MoE", "目标域、head、导出格式", "GPU smoke test", "部署脚本与验证日志", ["目标域配置", "模型"], "脚本与验证日志", "请把 UMA-MoE 部署到目标域，并完成最小验证。"),
    ],
  },
  "fengwu": {
    "suited": ["多变量中期预报", "跨变量融合", "六分支滚动推理", "气压层预报"],
    "notFor": ["缺六分支输入", "网格不一致", "只做单站点统计"],
    "prepare": ["surface/z/r/u/v/t", "压力层顺序", "归一化统计量"],
    "obtain": ["六分支预报场", "滚动输入", "评估指标"],
    "steps": ["校验六分支与气压层", "加载 FengWu", "单步推理", "滚动预报", "评估与落盘"],
    "scenarios": [
      ("prepare-branches", "整理六分支输入", "准备 surface 与高空 z/r/u/v/t 输入张量", "准备 FengWu 输入", "变量族、气压层、img_size", "远程盘挂载", "规范化六分支张量", ["ERA5/再分析", "统计量"], "六分支数据与检查报告", "请整理 FengWu 六个输入分支并核对气压层与网格。"),
      ("medium-range", "中期多变量预报", "执行跨变量融合的中期预报推理", "FengWu 中期预报", "lead time、滚动步数、设备", "远程 GPU", "六分支预报场", ["六分支输入", "权重"], "预报场与日志", "请运行 FengWu 中期预报，先单步冒烟再滚动。"),
      ("evaluate", "评估跨变量技巧", "分变量评估地表与高空预报技巧", "评估 FengWu", "RMSE/ACC、分变量", "GPU/CPU", "评估表与对比图", ["预报", "真值"], "评估表与结论", "请评估 FengWu 分变量技巧并给出改进建议。"),
      ("setup", "配置权重与环境", "检查 FengWu 依赖、权重和示例入口", "配置 FengWu 环境", "框架、GPU、路径", "登录节点+GPU", "环境说明与验证命令", ["机器权限"], "环境说明", "请配置 FengWu 环境并给出最小验证命令。"),
    ],
  },
  "fourcastnet": {
    "suited": ["全球二维场预报", "AFNO 谱混合", "patch 推理", "单时刻外推"],
    "notFor": ["非规则经纬网格", "缺二维气象场", "需要显式三维气压层建模"],
    "prepare": ["二维气象场", "patch 配置", "AFNO 权重"],
    "obtain": ["下一时刻场", "评估指标", "可视化"],
    "steps": ["核对网格与通道", "加载 FourCastNet", "单步推理", "多步滚动", "评估"],
    "scenarios": [
      ("prepare-grid", "准备二维天气场", "整理经纬网格气象场与通道顺序", "准备 FourCastNet 输入", "通道、分辨率、归一化", "远程盘", "规范化二维场", ["再分析场"], "输入场与检查报告", "请准备 FourCastNet 二维输入场并核对通道。"),
      ("afno-forecast", "AFNO 全球预报", "用谱混合 AFNO 做全球场预报", "FourCastNet 预报", "patch、modes、步长", "远程 GPU", "预报场与日志", ["输入场", "权重"], "预报场", "请运行 FourCastNet/AFNO 预报并保存输出。"),
      ("evaluate", "评估谱预报误差", "评估全球场 RMSE 与频谱误差", "评估 FourCastNet", "RMSE、频谱指标", "GPU", "误差表与谱图", ["预报", "真值"], "评估结果", "请评估 FourCastNet 误差，关注大尺度谱特征。"),
      ("setup", "配置 AFNO 环境", "检查 FourCastNet 运行环境与权重", "配置 FourCastNet", "依赖、权重路径", "登录节点+GPU", "验证命令", ["权限"], "环境说明", "请配置 FourCastNet 并完成最小验证。"),
    ],
  },
  "fuxi": {
    "suited": ["多时刻时空预报", "3D patch 预测", "全球场生成", "目标时刻推理"],
    "notFor": ["单帧且无时间维", "时空分辨率不匹配", "缺预训练权重"],
    "prepare": ["多时间步气象场", "3D patch 配置", "FuXi 权重"],
    "obtain": ["目标时刻预报", "评估指标", "可视化"],
    "steps": ["组织时间维输入", "加载 FuXi", "目标时刻推理", "评估", "落盘"],
    "scenarios": [
      ("prepare-timesteps", "整理多时刻输入", "把多时间步二维场整理为 FuXi 输入", "准备 FuXi 输入", "时间步、经纬、通道", "远程盘", "时空张量", ["多时刻场"], "输入与检查报告", "请整理 FuXi 多时刻输入并核对 patch 配置。"),
      ("target-forecast", "目标时刻预报", "从历史场生成目标时刻预测场", "FuXi 目标时刻预报", "lead time、patch、设备", "远程 GPU", "目标场与日志", ["多时刻输入", "权重"], "预报场", "请运行 FuXi 生成目标时刻预报。"),
      ("evaluate", "评估时空预报", "评估目标时刻误差与空间技巧", "评估 FuXi", "RMSE/ACC", "GPU", "评估表", ["预报", "真值"], "评估结论", "请评估 FuXi 时空预报技巧。"),
      ("setup", "配置 FuXi 环境", "检查依赖与权重", "配置 FuXi", "框架、路径", "登录节点+GPU", "验证命令", ["权限"], "环境说明", "请配置 FuXi 环境并验证。"),
    ],
  },
  "graphcast": {
    "suited": ["网格到网格预报", "多分辨率 mesh", "GNN 全球预报", "grid-mesh 映射"],
    "notFor": ["无法构建 icosahedral mesh", "缺网格特征", "只做局地雷达临近"],
    "prepare": ["经纬网格特征", "mesh 层级", "GraphCast 权重"],
    "obtain": ["网格预报场", "评估指标", "中间 mesh 表征"],
    "steps": ["构建 grid-mesh", "加载 GraphCast", "单步推理", "滚动预报", "评估"],
    "scenarios": [
      ("build-mesh", "构建 grid-mesh", "准备经纬网格到多分辨率 mesh 映射", "准备 GraphCast 图", "mesh 层级、特征通道", "远程盘/CPU", "graph 数据", ["网格场"], "mesh 与映射文件", "请构建 GraphCast grid-mesh 并核对特征。"),
      ("gnn-forecast", "GNN 全球预报", "在 mesh 上执行 GraphCast 预报", "GraphCast 预报", "步长、设备、滚动", "远程 GPU", "预报场", ["graph 输入", "权重"], "预报场与日志", "请运行 GraphCast 预报并保存网格输出。"),
      ("evaluate", "评估 mesh 预报", "评估网格场技巧与稳定性", "评估 GraphCast", "RMSE/ACC", "GPU", "评估表", ["预报", "真值"], "评估结论", "请评估 GraphCast 预报技巧。"),
      ("setup", "配置 GraphCast 环境", "检查运行入口与权重", "配置 GraphCast", "运行时、权重", "登录节点+GPU", "验证命令", ["权限"], "环境说明", "请配置 GraphCast 并验证示例。"),
    ],
  },
  "nowcastnet": {
    "suited": ["短临降水外推", "雷达回波预报", "运动场生成", "生成式临近预报"],
    "notFor": ["无雷达/降水序列", "中期全球大气任务", "缺运动/强度标签"],
    "prepare": ["雷达回波序列", "归一化", "NowcastNet 权重"],
    "obtain": ["短临降水场", "运动场", "评估指标"],
    "steps": ["整理雷达序列", "加载 NowcastNet", "短临推理", "评估 CSI/RMSE", "可视化"],
    "scenarios": [
      ("prepare-radar", "准备雷达序列", "整理短临降水/雷达回波输入", "准备 NowcastNet 输入", "时间窗、分辨率、归一化", "本地/远程盘", "雷达张量", ["雷达数据"], "序列与检查报告", "请准备 NowcastNet 雷达序列输入。"),
      ("nowcast", "短临降水外推", "生成未来短时降水/回波场", "NowcastNet 短临预报", "预报时效、生成配置", "远程 GPU", "短临场与运动场", ["雷达序列", "权重"], "预报结果", "请运行 NowcastNet 短临外推并保存输出。"),
      ("evaluate", "评估临近预报", "用 CSI/RMSE 等评估短临技巧", "评估 NowcastNet", "CSI、RMSE、时效曲线", "GPU/CPU", "评估表与图", ["预报", "真值"], "评估结论", "请评估 NowcastNet 短临技巧。"),
      ("setup", "配置短临环境", "检查依赖与权重", "配置 NowcastNet", "框架、路径", "登录节点+GPU", "验证命令", ["权限"], "环境说明", "请配置 NowcastNet 并验证。"),
    ],
  },
  "pangu": {
    "suited": ["三维大气预报", "地表+高空联合", "中短期全球预报", "滚动推理"],
    "notFor": ["无法拼成统一张量", "缺地表/高空通道", "仅海洋涡旋任务"],
    "prepare": ["地表与高空变量", "压力层", "Pangu 权重"],
    "obtain": ["地表预报", "高空预报", "滚动输入"],
    "steps": ["拼接输入张量", "加载 Pangu", "单步推理", "滚动预报", "评估"],
    "scenarios": [
      ("prepare-3d", "整理三维大气输入", "组织地表、静态掩码与高空变量", "准备 Pangu 输入", "通道顺序、气压层、网格", "远程盘", "三维输入张量", ["ERA5 等"], "输入与检查报告", "请整理 Pangu 三维大气输入。"),
      ("atmosphere-forecast", "三维大气预报", "联合预测地表与高空场", "Pangu 大气预报", "lead time、滚动、设备", "远程 GPU", "地表/高空预报", ["输入", "权重"], "预报场", "请运行 Pangu-Weather 预报。"),
      ("evaluate", "评估大气技巧", "分地表/高空评估预报误差", "评估 Pangu", "RMSE/ACC", "GPU", "评估表", ["预报", "真值"], "评估结论", "请评估 Pangu 地表与高空技巧。"),
      ("setup", "配置 Pangu 环境", "检查示例与权重路径", "配置 Pangu", "依赖、分布式可选", "登录节点+GPU", "验证命令", ["权限"], "环境说明", "请配置 Pangu-Weather 环境。"),
    ],
  },
  "xihe": {
    "suited": ["全球海洋预报", "涡旋分辨", "海陆掩膜建模", "海洋变量外推"],
    "notFor": ["纯大气任务", "无海洋变量", "缺海陆掩膜"],
    "prepare": ["海洋变量场", "海陆掩膜", "Xihe 权重"],
    "obtain": ["海洋预报场", "评估指标", "可视化"],
    "steps": ["准备海洋场与掩膜", "加载 Xihe", "预报推理", "评估", "落盘"],
    "scenarios": [
      ("prepare-ocean", "准备海洋输入场", "整理海洋变量与海陆掩膜", "准备 Xihe 输入", "变量、掩膜、分辨率", "远程盘", "海洋张量", ["海洋再分析"], "输入与检查报告", "请准备 Xihe 海洋输入与掩膜。"),
      ("ocean-forecast", "海洋涡旋预报", "执行高分辨率海洋场预报", "Xihe 海洋预报", "步长、掩膜、设备", "远程 GPU", "海洋预报场", ["输入", "权重"], "预报场", "请运行 Xihe 海洋预报。"),
      ("evaluate", "评估海洋技巧", "评估涡旋区与全局误差", "评估 Xihe", "RMSE、涡旋指标", "GPU", "评估表", ["预报", "真值"], "评估结论", "请评估 Xihe 海洋预报技巧。"),
      ("setup", "配置 Xihe 环境", "检查依赖与权重", "配置 Xihe", "框架、路径", "登录节点+GPU", "验证命令", ["权限"], "环境说明", "请配置 Xihe 环境并验证。"),
    ],
  },
}

CFD_FLOWS = {
  "BE_MPNN": ("边界嵌入求解", "复杂边界椭圆 PDE 代理", "边界条件编码", "BENO 基准评估"),
  "deeponet": ("Branch-Trunk 算子学习", "函数到场回归", "DeepONet 训练", "算子泛化评估"),
  "f_fno": ("因子化傅里叶训练", "结构化网格场预测", "F-FNO 基准评估", "谱模态消融"),
  "factformer": ("因子化注意力训练", "网格场回归推理", "FactFormer 评估", "注意力可视化"),
  "fno": ("傅里叶算子训练", "规则网格场预测", "FNO 基准对比", "谱截断敏感性"),
  "galerkin_transformer": ("Galerkin 注意力训练", "算子场回归", "基准评估", "注意力稳定性检查"),
  "gfno": ("等变傅里叶训练", "对称约束场预测", "GFNO 评估", "对称性保持检验"),
  "gnot": ("交叉注意力算子训练", "GNOT 场回归", "基准评估", "几何泛化测试"),
  "graphViT": ("网格时序预报", "图视觉 Transformer 训练", "动态网格评估", "多步滚动推理"),
  "graph_unet": ("多尺度图 U-Net 训练", "非结构网格预测", "跨尺度评估", "池化策略对比"),
  "graphsage": ("邻域聚合训练", "非结构网格回归", "GraphSAGE 评估", "采样邻居敏感性"),
  "lsm": ("潜空间谱模型训练", "混合算子场预测", "LSM 基准评估", "多尺度误差分析"),
  "meshgraphnet": ("网格图消息传递训练", "非结构 CFD 预测", "MeshGraphNet 评估", "分布式推理验证"),
  "mwt": ("多小波算子训练", "结构化 PDE 代理", "MWT 基准评估", "小波基对比"),
  "ono": ("正交算子训练", "注意力场回归", "ONO 评估", "正交约束检查"),
  "pointnet": ("点云 MLP 基线训练", "非结构点回归", "PointNet 评估", "点序不变性检查"),
  "regdgcnn": ("动态图卷积训练", "局部邻域点云回归", "RegDGCNN 评估", "动态边重建检查"),
  "swin_transformer": ("窗口注意力训练", "结构化场预测", "Swin 评估", "窗口尺寸消融"),
  "transformer": ("自注意力算子训练", "场到场回归", "Transformer 评估", "序列长度敏感性"),
  "transolver": ("物理注意力训练", "翼型/汽车设计代理", "Transolver 评估", "设计工况推理"),
  "u_fno": ("U-FNO 多尺度训练", "傅里叶+U 路径预测", "U-FNO 评估", "多尺度残差分析"),
  "u_net": ("U-Net 场预测训练", "结构化 CFD 回归", "U-Net 基线评估", "编解码分辨率检查"),
  "u_no": ("U 型神经算子训练", "多尺度算子预测", "U-NO 评估", "跳跃连接消融"),
}

BIO_FLOWS = {
  "alphafold": ("单体结构预测", "多聚体复合物预测", "置信度 pLDDT/PAE 评估", "MSA 特征准备"),
  "alphafold3": ("复合物结构预测", "蛋白-核酸-配体建模", "扩散采样推理", "置信度与排序评估"),
  "alphagenome": ("DNA 功能轨迹预测", "变异效应打分", "调控基因组推理", "多轨道评估"),
  "diffdock": ("蛋白-配体对接采样", "构象置信度重排", "对接姿势评估", "受体配体输入准备"),
  "esm": ("蛋白表征提取", "接触/结构预测", "变异效应打分", "序列嵌入分析"),
  "evo2": ("基因组序列建模", "长序列生成", "DNA token 推理", "生成质量评估"),
  "genscore": ("蛋白-配体亲和打分", "虚拟筛选排序", "贡献度分析", "复合物图准备"),
  "laproteina": ("蛋白骨架生成", "motif scaffolding", "可设计性评估", "flow matching 采样"),
  "medgemma": ("医学问答推理", "医学影像理解", "多模态临床文本生成", "回答质量评估"),
  "molsculptor": ("小分子生成", "分子优化设计", "SMILES 采样", "性质约束评估"),
  "openfold": ("AF2 风格折叠", "MSA/模板推理", "结构置信度评估", "PyTorch 权重配置"),
  "proteinmpnn": ("骨架条件序列设计", "逆向折叠采样", "序列恢复率评估", "PDB 骨架准备"),
  "protenix": ("AF3 风格复合物预测", "配体/核酸共折叠", "扩散推理", "复合物质量评估"),
  "protoken": ("结构离散编码", "VQ 重建评估", "token 序列导出", "PT-DiT 输入准备"),
  "pt_dit": ("序列结构共设计", "ProToken 扩散生成", "de novo 设计采样", "设计质量评估"),
  "rfdiffusion": ("蛋白骨架扩散生成", "binder 设计", "motif 脚手架", "设计可折叠性评估"),
  "simplefold": ("流匹配折叠预测", "快速结构生成", "折叠质量评估", "序列输入准备"),
  "targetdiff": ("口袋条件配体生成", "三维扩散采样", "对接姿势评估", "口袋与配体准备"),
}

def parse_sections(md: str):
  sections, current, buf = {}, None, []
  for line in md.splitlines():
    if line.startswith("# "):
      if current is not None:
        sections[current] = "\n".join(buf).strip()
      current = line[2:].strip()
      buf = []
    else:
      buf.append(line)
  if current is not None:
    sections[current] = "\n".join(buf).strip()
  return sections

def first_sentence(text, fallback):
  text = re.sub(r"\s+", " ", (text or "").strip())
  if not text:
    return fallback
  for sep in ["。", ". ", "；"]:
    if sep in text:
      s = text.split(sep)[0].strip("。.;； ")
      break
  else:
    s = text
  s = re.sub(r"`[^`]+`", "", s)
  s = re.sub(r"\s+", " ", s).strip()
  return s[:71] + "…" if len(s) > 72 else s

def blurb_from(desc, name):
  s = first_sentence(desc, name + " 是 OneScience 科研基座模型")
  if not s.endswith(("。", "…")):
    s += "。"
  return s

def ts_str(s):
  return json.dumps(s, ensure_ascii=False)

def ts_arr(items):
  return "[" + ", ".join(ts_str(x) for x in items) + "]"

NL_JOIN = '].join("\\n")'

def tag_list(meta_tags, domain_label):
  tags = [domain_label]
  mapping = {
    "interatomic-potential": "mlff", "energy-force-prediction": "能量力", "energy-force-stress": "能量力应力",
    "structure-relaxation": "弛豫", "magnetic-moment": "磁矩", "universal-mlip": "通用势", "mixture-of-experts": "MoE",
    "weather-forecast": "预报", "medium-range-forecast": "中期", "global-atmosphere": "全球",
    "precipitation-nowcasting": "短临", "ocean-forecast": "海洋", "fourier-operator": "算子学习",
    "cfd": "CFD", "protein": "蛋白", "structure-prediction": "结构预测", "msa": "MSA",
    "diffusion": "扩散", "molecule-generation": "分子生成",
  }
  for t in meta_tags or []:
    m = mapping.get(t)
    if m and m not in tags:
      tags.append(m)
    if len(tags) >= 4:
      break
  return tags[:4]

def fields_block(domain_key, name):
  _ui, _label, sys_label, sys_ph, data_ph, env_ph = DOMAIN_META[domain_key]
  goal_ph = "例如：用 " + name + " 完成目标任务"
  return (
    "[\n"
    '      { id: "system", label: ' + ts_str(sys_label) + ", placeholder: " + ts_str(sys_ph) + " },\n"
    "      {\n"
    '        id: "inputData",\n'
    '        label: "输入数据",\n'
    "        placeholder: " + ts_str(data_ph) + ",\n"
    "        multiline: true,\n"
    "      },\n"
    '      { id: "goal", label: "任务目标", placeholder: ' + ts_str(goal_ph) + ", multiline: true },\n"
    '      { id: "environment", label: "运行环境", placeholder: ' + ts_str(env_ph) + " },\n"
    "    ]"
  )

def pack_from_titles(mid, domain_key, titles):
  name = DISPLAY[mid]
  docs = DOCS[mid]
  t1, t2, t3, t4 = titles
  if domain_key == "cfd":
    not_for = ["几何协议不匹配", "无监督标签", "输入通道无法对齐"]
    prepare = ["网格/点云/图数据", "输入输出通道", "训练配置"]
    obtain = ["预测场", "误差指标", "可复现配置"]
    steps = ["核对几何与通道", "配置 " + name, "forward 冒烟", t1, "导出结果"]
  else:
    not_for = ["输入协议不完整", "权重缺失", "非该模型适用分子类型"]
    prepare = ["序列/结构/配体", "模型配置与权重", "特征管线输出"]
    obtain = ["预测或生成结果", "置信度/打分", "下游文件"]
    steps = ["准备输入", "配置 " + name, "冒烟推理", t1, "整理结果"]
  scenarios = []
  for sid, title in [("task-a", t1), ("task-b", t2), ("task-c", t3), ("task-d", t4)]:
    scenarios.append((
      sid, title, "使用 " + name + " 做" + title, title,
      "关键超参、数据协议与运行配置", "远程 GPU；先冒烟再正式运行", title + "产物与日志",
      ["输入数据", "配置或权重"], title + "结果",
      "请按 OneScience " + name + "（" + docs + "）完成「" + title + "」。",
    ))
  return {
    "suited": [t1, t2, t3, t4],
    "notFor": not_for,
    "prepare": prepare,
    "obtain": obtain,
    "steps": steps,
    "scenarios": scenarios,
  }

def get_flow(domain_key, mid):
  if mid in MODEL_FLOWS:
    return MODEL_FLOWS[mid]
  if domain_key == "cfd":
    return pack_from_titles(mid, "cfd", CFD_FLOWS[mid])
  if domain_key == "bio":
    return pack_from_titles(mid, "bio", BIO_FLOWS[mid])
  raise KeyError(mid)

def emit_scenarios(domain_key, mid, name, docs, flow):
  fields = fields_block(domain_key, name)
  parts = []
  for spec in flow["scenarios"]:
    sid, title, summary, current, keycfg, resources, deliverables, req, expected, extra = spec
    prompt_lines = [
      "请基于 {{system}} 体系完成 " + name + "「" + title + "」任务。",
      "输入数据：{{inputData}}",
      "任务目标：{{goal}}",
      "运行环境：{{environment}}",
      "",
      extra + ("。" if not extra.endswith("。") else "") + "参考 OneScience 路径：" + docs + "。",
      "如需安装依赖、加载模块或提交远程命令，请先向我请求批准。",
    ]
    prompt_ts = ",\n        ".join(ts_str(p) for p in prompt_lines)
    parts.append(
      "    {\n"
      '      id: "' + mid + "-" + sid + '",\n'
      "      title: " + ts_str(title) + ",\n"
      "      summary: " + ts_str(summary) + ",\n"
      "      fields: " + fields + ",\n"
      "      capabilitySummary: {\n"
      "        current: " + ts_str(current) + ",\n"
      "        keyConfig: " + ts_str(keycfg) + ",\n"
      "        resources: " + ts_str(resources) + ",\n"
      "        deliverables: " + ts_str(deliverables) + ",\n"
      "      },\n"
      "      requiredData: " + ts_arr(req) + ",\n"
      "      expectedOutputs: " + ts_str(expected) + ",\n"
      "      promptTemplate: [\n"
      "        " + prompt_ts + ",\n"
      "      " + NL_JOIN + ",\n"
      "    }"
    )
  return ",\n".join(parts)

def emit(domain_key, mid, meta, sections):
  ui, domain_label = DOMAIN_META[domain_key][0], DOMAIN_META[domain_key][1]
  name = DISPLAY[mid]
  docs_path = DOCS[mid]
  flow = get_flow(domain_key, mid)
  desc = meta.get("description") or sections.get("description", "")
  subtitle = first_sentence(desc, "使用 " + name + " 完成" + domain_label + "科研任务")
  blurb = blurb_from(desc, name)
  tags = tag_list(meta.get("tags"), domain_label)
  scenario_titles = [s[1] for s in flow["scenarios"][:3]]
  install_prompt = [
    "请为 " + name + " 创建一个可以直接跑通的环境配置任务。",
    "模型定位：" + subtitle + "。",
    "适合任务：" + "、".join(flow["suited"]) + "。",
    "典型输入：" + " / ".join(flow["prepare"]) + "。",
    "典型输出：" + " / ".join(flow["obtain"]) + "。",
    "要求：",
    "1. 先检查当前项目、Python/框架版本、CPU/GPU/DCU、远程环境和项目目录权限。",
    "2. 优先核对 OneScience 入口（" + docs_path + "）与数据/权重路径是否可用。",
    "3. 如果需要模型权重、训练数据或插件，请列出来源、版本和下载/挂载方式。",
    "4. 如果需要安装依赖、加载模块或执行远程命令，请先向我请求批准。",
    "5. 安装/配置完成后，请给出最小验证命令，并说明下一步可以进入：" + " / ".join(scenario_titles) + "。",
  ]
  var = re.sub(r"[^a-zA-Z0-9_]", "_", mid)
  if var[0].isdigit():
    var = "m_" + var
  install_ts = ",\n      ".join(ts_str(p) for p in install_prompt)
  code = (
    "export const " + var + ": CapabilityResource = {\n"
    "  id: " + ts_str(mid) + ",\n"
    "  name: " + ts_str(name) + ",\n"
    '  category: "onemodel",\n'
    "  domain: " + ts_str(ui) + ",\n"
    "  tags: " + ts_arr(tags) + ",\n"
    "  blurb: " + ts_str(blurb) + ",\n"
    "  docsHref: " + ts_str(GITEE + "/" + docs_path) + ",\n"
    "  intro: {\n"
    '    title: "30 秒看懂模型",\n'
    "    subtitle: " + ts_str(subtitle) + ",\n"
    "    suited: " + ts_arr(flow["suited"]) + ",\n"
    "    notFor: " + ts_arr(flow["notFor"]) + ",\n"
    "    prepare: " + ts_arr(flow["prepare"]) + ",\n"
    "    obtain: " + ts_arr(flow["obtain"]) + ",\n"
    "    steps: " + ts_arr(flow["steps"]) + ",\n"
    "  },\n"
    "  install: {\n"
    "    banner: " + ts_str("已为你创建 " + name + " 环境配置任务") + ",\n"
    "    prompt: [\n"
    "      " + install_ts + ",\n"
    "    " + NL_JOIN + ",\n"
    "  },\n"
    "  scenarios: [\n"
    + emit_scenarios(domain_key, mid, name, docs_path, flow) + "\n"
    "  ],\n"
    "}\n"
  )
  return var, code, " / ".join(scenario_titles)

def main():
  parts = ['import type { CapabilityResource } from "./catalog"\n\n/** Auto-generated from oneskills onescience-primitives model assets. */\n']
  ids = []
  card_labels = {}
  for domain_key in ["matchem", "climate", "cfd", "bio"]:
    model_dir = ASSETS / domain_key / "models"
    for mid in sorted(p.name for p in model_dir.iterdir() if p.is_dir()):
      if mid in {"mace", "deepmd"}:
        continue
      meta_path = model_dir / mid / "metadata.json"
      wf_path = model_dir / mid / "workflow_planning.md"
      meta = json.loads(meta_path.read_text()) if meta_path.exists() else {"tags": [], "description": ""}
      sections = parse_sections(wf_path.read_text()) if wf_path.exists() else {}
      var, code, label = emit(domain_key, mid, meta, sections)
      parts.append(code)
      ids.append(var)
      card_labels[mid] = label

  parts.append("export const generatedOnemodels: CapabilityResource[] = [\n  " + ",\n  ".join(ids) + ",\n]\n")
  OUT.write_text("\n".join(parts))

  by_domain = defaultdict(list)
  for domain_key in ["matchem", "climate", "cfd", "bio"]:
    for mid in sorted(p.name for p in (ASSETS / domain_key / "models").iterdir() if p.is_dir()):
      if mid in {"mace", "deepmd"}:
        continue
      by_domain[domain_key].append((mid, card_labels[mid]))
  for d, items in by_domain.items():
    labels = [x[1] for x in items]
    print(d + ":", str(len(set(labels))) + "/" + str(len(labels)), "unique")
  print("materials:")
  for m in ["matris", "uma_escn_md", "uma_escn_moe"]:
    print(" ", m, "=>", card_labels[m])
  print("wrote", OUT, "bytes", OUT.stat().st_size)

if __name__ == "__main__":
  main()
