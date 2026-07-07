-- 1. 主融合名称索引
CREATE INDEX IF NOT EXISTS idx_fusion_name ON fusion("Fusion.Name");
CREATE INDEX IF NOT EXISTS idx_fusion_name_upper ON fusion(UPPER("Fusion.Name"));

-- 2. 备用融合名称字段（如果你的查询用 new.fusion.name）
CREATE INDEX IF NOT EXISTS idx_new_fusion_name ON fusion("new.fusion.name");
CREATE INDEX IF NOT EXISTS idx_new_fusion_name_upper ON fusion(UPPER("new.fusion.name"));

-- 3. 左右基因索引
CREATE INDEX IF NOT EXISTS idx_left_gene ON fusion("LeftGene");
CREATE INDEX IF NOT EXISTS idx_right_gene ON fusion("RightGene");
CREATE INDEX IF NOT EXISTS idx_left_gene_upper ON fusion(UPPER("LeftGene"));
CREATE INDEX IF NOT EXISTS idx_right_gene_upper ON fusion(UPPER("RightGene"));

-- 4. 左右断点索引
CREATE INDEX IF NOT EXISTS idx_left_breakpoint ON fusion("LeftBreakpoint");
CREATE INDEX IF NOT EXISTS idx_right_breakpoint ON fusion("RightBreakpoint");

-- 5. 样本名
CREATE INDEX IF NOT EXISTS idx_sample_name ON fusion("sample.name");

-- 6. 排序字段
CREATE INDEX IF NOT EXISTS idx_fq ON fusion(fq DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS idx_avg_ffpm ON fusion("Avg.FFPM" DESC NULLS LAST);

-- 7. 复合索引：名称 + 排序（常见用法）
CREATE INDEX IF NOT EXISTS idx_fusion_name_fq ON fusion("Fusion.Name", fq DESC NULLS LAST);
