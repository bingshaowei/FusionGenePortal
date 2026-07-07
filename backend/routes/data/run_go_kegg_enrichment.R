
args <- commandArgs(trailingOnly = TRUE)
if (length(args) < 3) {
  stop("Usage: Rscript run_go_kegg_enrichment.R <gene_file> <out_dir> <prefix>")
}

gene_file <- args[[1]]
out_dir <- args[[2]]
prefix <- args[[3]]
tmp_dir <- if (length(args) >= 4) args[[4]] else out_dir
dir.create(out_dir, showWarnings = FALSE, recursive = TRUE)
dir.create(tmp_dir, showWarnings = FALSE, recursive = TRUE)
log_step <- function(msg) {
  line <- paste0(format(Sys.time(), "%Y-%m-%d %H:%M:%S"), " | ", msg)
  cat(line, "\n")
}
log_step("R enrichment script started")
unlink(file.path(out_dir, "Rplots.pdf"), force = TRUE)

# 让网站调用 Rscript 时也能找到用户本地安装的 R 包。
# 优先使用环境变量 R_LIBS_USER；如果没有设置，兼容当前服务器的常用路径。
custom_lib <- Sys.getenv("R_LIBS_USER")
if (!identical(custom_lib, "") && dir.exists(custom_lib)) {
  .libPaths(unique(c(custom_lib, .libPaths())))
}
fallback_lib <- "/home/fenhuazu/R/library"
if (dir.exists(fallback_lib)) {
  .libPaths(unique(c(fallback_lib, .libPaths())))
}

# 注意：这里故意不加载 ggplot2/enrichplot/ggtree。
# 之前服务器上的 ggplot2 4.x + S7 会在“+”号拼图层时报
# Incompatible methods ("Ops.S7_object", "+.gg") for "+"。
# 因此富集计算仍用 clusterProfiler，绘图改成 base R，不再经过 ggplot2。
required_pkgs <- c("clusterProfiler", "org.Hs.eg.db", "AnnotationDbi")
missing_pkgs <- required_pkgs[!vapply(required_pkgs, requireNamespace, quietly = TRUE, FUN.VALUE = logical(1))]
if (length(missing_pkgs) > 0) {
  stop(paste0(
    "Missing R packages: ", paste(missing_pkgs, collapse = ", "),
    ". Current .libPaths(): ", paste(.libPaths(), collapse = " | "),
    ". Install with: if (!requireNamespace('BiocManager', quietly=TRUE)) install.packages('BiocManager'); ",
    "BiocManager::install(c('clusterProfiler','org.Hs.eg.db','AnnotationDbi'))"
  ))
}

suppressPackageStartupMessages({
  library(clusterProfiler)
  library(org.Hs.eg.db)
  library(AnnotationDbi)
})

genes <- unique(trimws(readLines(gene_file, warn = FALSE)))
genes <- genes[genes != ""]
if (length(genes) < 3) {
  stop("Too few genes for enrichment analysis")
}

gene_map <- tryCatch(
  clusterProfiler::bitr(
    genes,
    fromType = "SYMBOL",
    toType = c("ENTREZID", "SYMBOL"),
    OrgDb = org.Hs.eg.db
  ),
  error = function(e) data.frame()
)

if (nrow(gene_map) == 0) {
  stop("No gene symbols could be mapped to Entrez IDs. Please check gene symbols/species.")
}

entrez_ids <- unique(as.character(gene_map$ENTREZID))

ratio_to_num <- function(x) {
  if (length(x) == 0 || is.na(x) || x == "") return(NA_real_)
  parts <- strsplit(as.character(x), "/", fixed = TRUE)[[1]]
  if (length(parts) != 2) return(NA_real_)
  suppressWarnings(as.numeric(parts[[1]]) / as.numeric(parts[[2]]))
}

safe_numeric <- function(x, default = 1) {
  y <- suppressWarnings(as.numeric(x))
  y[is.na(y) | is.infinite(y)] <- default
  y
}

shorten_text <- function(x, max_chars = 70) {
  x <- as.character(x)
  ifelse(nchar(x) > max_chars, paste0(substr(x, 1, max_chars - 3), "..."), x)
}

save_empty_result <- function(key) {
  invisible(FALSE)
}

draw_base_dotplot <- function(plot_df, out_file, title, device = c("png", "pdf")) {
  device <- match.arg(device)
  n <- nrow(plot_df)
  if (n == 0) return(FALSE)

  # 反转顺序，让最显著条目显示在上方
  plot_df <- plot_df[rev(seq_len(n)), , drop = FALSE]
  y <- seq_len(n)
  x <- plot_df$GeneRatioNum
  x[is.na(x) | is.infinite(x)] <- 0
  count <- plot_df$Count
  neglog <- plot_df$NegLog10Padj

  scale_small_n <- if (n <= 4) 1.55 else if (n <= 8) 1.30 else if (n <= 12) 1.10 else 1.0
  label_cex <- if (n <= 4) 1.25 else if (n <= 8) 1.05 else if (n <= 12) 0.90 else 0.76
  axis_cex <- if (n <= 4) 1.25 else if (n <= 8) 1.12 else if (n <= 12) 1.00 else 0.90
  title_cex <- if (n <= 4) 1.45 else if (n <= 8) 1.32 else 1.20
  legend_cex <- if (n <= 4) 1.05 else if (n <= 8) 0.95 else 0.82
  point_cex <- (1.4 + 3.4 * (count - min(count, na.rm = TRUE)) / (max(count, na.rm = TRUE) - min(count, na.rm = TRUE) + 1e-9)) * scale_small_n
  pal <- grDevices::colorRampPalette(c("#3b82f6", "#a855f7", "#ef4444"))(100)
  col_idx <- floor(1 + 99 * (neglog - min(neglog, na.rm = TRUE)) / (max(neglog, na.rm = TRUE) - min(neglog, na.rm = TRUE) + 1e-9))
  col_idx[col_idx < 1] <- 1
  col_idx[col_idx > 100] <- 100
  point_col <- pal[col_idx]

  label <- shorten_text(plot_df$Description, if (n <= 6) 92 else 72)
  max_x <- max(x, na.rm = TRUE)
  if (!is.finite(max_x) || max_x <= 0) max_x <- 1

  if (device == "png") {
    grDevices::png(out_file, width = 1600, height = max(1050, 300 + n * 135), res = 170, bg = "white")
  } else {
    grDevices::pdf(out_file, width = 10.2, height = max(6.6, 2.8 + n * 0.52), onefile = FALSE)
  }
  on.exit(grDevices::dev.off(), add = TRUE)

  oldpar <- graphics::par(no.readonly = TRUE)
  on.exit(graphics::par(oldpar), add = TRUE)

  graphics::par(mar = c(5.8, if (n <= 6) 18.5 else 15.5, 5.2, 7.0), xpd = FALSE)
  graphics::plot(
    x, y,
    xlim = c(0, max_x * 1.12),
    ylim = c(0.5, n + 0.5),
    yaxt = "n",
    xlab = "Gene Ratio",
    ylab = "",
    main = title,
    pch = 21,
    bg = point_col,
    col = "white",
    cex = point_cex,
    lwd = 0.8,
    las = 1,
    bty = "l",
    cex.axis = axis_cex,
    cex.lab = axis_cex,
    cex.main = title_cex
  )
  graphics::grid(nx = NA, ny = NULL, col = "grey88", lty = "dotted")
  graphics::points(x, y, pch = 21, bg = point_col, col = "white", cex = point_cex, lwd = 0.8)
  graphics::axis(2, at = y, labels = label, las = 1, tick = FALSE, cex.axis = label_cex)

  # 颜色图例
  graphics::par(xpd = TRUE)
  legend_x <- max_x * 1.18
  legend_y <- n
  legend_vals <- pretty(neglog, n = 4)
  legend_vals <- legend_vals[is.finite(legend_vals)]
  if (length(legend_vals) > 0) {
    legend_cols <- pal[pmax(1, pmin(100, floor(1 + 99 * (legend_vals - min(neglog, na.rm = TRUE)) / (max(neglog, na.rm = TRUE) - min(neglog, na.rm = TRUE) + 1e-9))))]
    graphics::legend(
      legend_x, legend_y,
      legend = format(round(legend_vals, 2), trim = TRUE),
      pt.bg = legend_cols,
      pch = 21,
      pt.cex = 1.4,
      bty = "n",
      title = "-log10(FDR)",
      cex = legend_cex
    )
  }

  # 点大小图例：用分位数/范围点，并增大垂直间距，避免重叠
  count_vals <- unique(round(c(min(count, na.rm = TRUE), stats::quantile(count, probs = c(0.5, 0.8, 1), na.rm = TRUE))))
  count_vals <- sort(unique(count_vals[count_vals > 0]))
  if (length(count_vals) > 0) {
    count_cex <- 1.0 + 2.2 * (count_vals - min(count, na.rm = TRUE)) / (max(count, na.rm = TRUE) - min(count, na.rm = TRUE) + 1e-9)
    graphics::legend(
      legend_x, max(1, n - 6.2),
      legend = count_vals,
      pch = 21,
      pt.bg = "grey70",
      col = "white",
      pt.cex = count_cex,
      bty = "n",
      title = "Count",
      cex = legend_cex,
      y.intersp = 1.8,
      x.intersp = 0.8
    )
  }
  graphics::par(xpd = FALSE)
  return(TRUE)
}

save_enrichment_result <- function(enrich_obj, key, title) {
  out_csv <- file.path(tmp_dir, paste0(prefix, "_", key, ".csv"))
  out_png <- file.path(tmp_dir, paste0(prefix, "_", key, ".png"))
  out_pdf <- file.path(out_dir, paste0(prefix, "_", key, ".pdf"))

  ok <- tryCatch({
    if (is.null(enrich_obj)) {
      save_empty_result(key)
      return(FALSE)
    }

    df <- tryCatch(as.data.frame(enrich_obj), error = function(e) data.frame())
    if (nrow(df) == 0) {
      save_empty_result(key)
      return(FALSE)
    }

    # 兼容 clusterProfiler 输出列。前端会继续读取 CSV，所以这里尽量保留完整结果。
    if (!"GeneRatio" %in% colnames(df)) df$GeneRatio <- NA_character_
    if (!"Count" %in% colnames(df)) df$Count <- 1
    if (!"p.adjust" %in% colnames(df)) {
      if ("qvalue" %in% colnames(df)) {
        df$p.adjust <- df$qvalue
      } else if ("pvalue" %in% colnames(df)) {
        df$p.adjust <- df$pvalue
      } else {
        df$p.adjust <- 1
      }
    }
    if (!"Description" %in% colnames(df)) {
      if ("ID" %in% colnames(df)) {
        df$Description <- df$ID
      } else {
        df$Description <- paste0("Term_", seq_len(nrow(df)))
      }
    }

    df$GeneRatioNum <- vapply(df$GeneRatio, ratio_to_num, numeric(1))
    df$GeneRatioNum[is.na(df$GeneRatioNum) | is.infinite(df$GeneRatioNum)] <- 0
    df$Count <- safe_numeric(df$Count, default = 1)
    df$p.adjust <- safe_numeric(df$p.adjust, default = 1)
    df$NegLog10Padj <- -log10(pmax(df$p.adjust, 1e-300))

    # 按 Count 从高到低排序；Count 相同时再按 FDR 从小到大排序。
    df <- df[order(-df$Count, df$p.adjust), , drop = FALSE]
    tryCatch(write.csv(df, out_csv, row.names = FALSE), error = function(e) {
      message("write csv failed for ", key, ": ", conditionMessage(e))
    })

    show_n <- min(20, nrow(df))
    plot_df <- head(df, show_n)
    if (nrow(plot_df) == 0) return(FALSE)

    png_ok <- draw_base_dotplot(plot_df, out_png, title, device = "png")
    pdf_ok <- draw_base_dotplot(plot_df, out_pdf, title, device = "pdf")
    return(isTRUE(pdf_ok) && isTRUE(png_ok) && file.exists(out_pdf))
  }, error = function(e) {
    message("save_enrichment_result failed for ", key, ": ", conditionMessage(e))
    FALSE
  })

  return(ok)
}

run_go <- function(ont) {
  tryCatch(
    clusterProfiler::enrichGO(
      gene = entrez_ids,
      OrgDb = org.Hs.eg.db,
      keyType = "ENTREZID",
      ont = ont,
      pAdjustMethod = "BH",
      pvalueCutoff = 0.05,
      qvalueCutoff = 0.20,
      readable = TRUE
    ),
    error = function(e) {
      message("enrichGO failed for ", ont, ": ", conditionMessage(e))
      NULL
    }
  )
}

log_step("GO BP started")
go_bp <- run_go("BP")
log_step("GO MF started")
go_mf <- run_go("MF")
log_step("GO CC started")
go_cc <- run_go("CC")

log_step("Saving GO BP")
save_enrichment_result(go_bp, "go_bp", "GO Biological Process")
log_step("Saving GO MF")
save_enrichment_result(go_mf, "go_mf", "GO Molecular Function")
log_step("Saving GO CC")
save_enrichment_result(go_cc, "go_cc", "GO Cellular Component")
log_step("GO outputs saved")

# KEGG: prefer a local pathway-gene cache. If the cache does not exist, create
# it once from KEGGREST; future analyses run offline from CSV files.
kegg_obj <- NULL
kegg_source <- "local KEGG cache"
save_empty_result("kegg")

normalize_kegg_cache <- function(links, names_vec) {
  left <- names(links)
  right <- unname(links)
  term <- ifelse(grepl("path:", left), left, right)
  gene <- ifelse(grepl("^hsa:", left), left, right)
  term <- sub("^path:", "", term)
  gene <- sub("^hsa:", "", gene)
  term2gene <- unique(data.frame(term = as.character(term), gene = as.character(gene)))
  term2gene <- term2gene[grepl("^hsa[0-9]+$", term2gene$term) & grepl("^[0-9]+$", term2gene$gene), , drop = FALSE]

  term_ids <- sub("^path:", "", names(names_vec))
  term_names <- sub(" - Homo sapiens \\(human\\)$", "", as.character(names_vec))
  term2name <- unique(data.frame(term = as.character(term_ids), name = as.character(term_names)))
  term2name <- term2name[grepl("^hsa[0-9]+$", term2name$term), , drop = FALSE]
  list(term2gene = term2gene, term2name = term2name)
}

load_or_create_kegg_cache <- function() {
  cache_dir <- file.path(dirname(out_dir), "kegg_cache")
  dir.create(cache_dir, showWarnings = FALSE, recursive = TRUE)
  term2gene_file <- file.path(cache_dir, "hsa_kegg_term2gene.csv")
  term2name_file <- file.path(cache_dir, "hsa_kegg_term2name.csv")

  if (file.exists(term2gene_file) && file.exists(term2name_file)) {
    term2gene <- read.csv(term2gene_file, stringsAsFactors = FALSE)
    term2name <- read.csv(term2name_file, stringsAsFactors = FALSE)
    if (nrow(term2gene) > 0 && nrow(term2name) > 0) {
      log_step(paste0("Using local KEGG cache: TERM2GENE rows=", nrow(term2gene)))
      return(list(term2gene = term2gene, term2name = term2name, source = "local KEGG cache"))
    }
  }

  if (!requireNamespace("KEGGREST", quietly = TRUE)) {
    stop("KEGGREST is not installed and local KEGG cache is missing")
  }

  old_timeout <- getOption("timeout")
  options(timeout = max(120, old_timeout))
  on.exit(options(timeout = old_timeout), add = TRUE)

  last_error <- NULL
  for (attempt in seq_len(5)) {
    log_step(paste0("Creating KEGG cache from KEGGREST attempt ", attempt))
    cache <- tryCatch({
      links <- KEGGREST::keggLink("pathway", "hsa")
      names_vec <- KEGGREST::keggList("pathway", "hsa")
      normalize_kegg_cache(links, names_vec)
    }, error = function(e) {
      last_error <<- conditionMessage(e)
      NULL
    })

    if (!is.null(cache) && nrow(cache$term2gene) > 0 && nrow(cache$term2name) > 0) {
      write.csv(cache$term2gene, term2gene_file, row.names = FALSE)
      write.csv(cache$term2name, term2name_file, row.names = FALSE)
      log_step(paste0("KEGG cache created: TERM2GENE rows=", nrow(cache$term2gene)))
      cache$source <- "KEGGREST-created local KEGG cache"
      return(cache)
    }
    Sys.sleep(2 * attempt)
  }

  stop(paste0("Could not create KEGG cache from KEGGREST: ", last_error))
}

log_step("KEGG local cache enrichment started")
kegg_cache <- tryCatch(load_or_create_kegg_cache(), error = function(e) {
  kegg_source <<- paste0("KEGG cache unavailable: ", conditionMessage(e))
  message(kegg_source)
  NULL
})

if (!is.null(kegg_cache)) {
  kegg_source <- kegg_cache$source
  kegg_obj <- tryCatch(
    clusterProfiler::enricher(
      gene = entrez_ids,
      TERM2GENE = kegg_cache$term2gene,
      TERM2NAME = kegg_cache$term2name,
      pAdjustMethod = "BH",
      pvalueCutoff = 0.2,
      qvalueCutoff = 0.2,
      minGSSize = 5
    ),
    error = function(e) {
      kegg_source <<- paste0("local KEGG enricher failed: ", conditionMessage(e))
      message(kegg_source)
      NULL
    }
  )
}

if (!is.null(kegg_obj) && nrow(as.data.frame(kegg_obj)) > 0) {
  kegg_source <- paste0(kegg_source, "; enriched terms=", nrow(as.data.frame(kegg_obj)))
  log_step(kegg_source)
} else if (is.null(kegg_obj)) {
  log_step(kegg_source)
} else {
  kegg_source <- paste0(kegg_source, "; no enriched term passed cutoff")
  log_step(kegg_source)
}

log_step("Saving KEGG output")
save_enrichment_result(kegg_obj, "kegg", "KEGG Pathway")
log_step("R enrichment script finished")

meta <- data.frame(
  input_gene_count = length(genes),
  mapped_gene_count = length(entrez_ids),
  kegg_source = kegg_source,
  plot_engine = "base R graphics; no ggplot2/enrichplot dotplot",
  stringsAsFactors = FALSE
)
unlink(file.path(out_dir, "Rplots.pdf"), force = TRUE)
