# backend/upload_fusion.py
import pandas as pd
from app import create_app
from extensions import db
from models import Fusion, FusionAll
import numpy as np

def clean_value(value):
    """清理数据值，处理NaN和空值"""
    if pd.isna(value) or value == '' or value == 'NA':
        return None
    return value

def upload_fusion_data(csv_file_path):
    """上传Fusion数据到数据库"""
    app = create_app()
    
    with app.app_context():
        print("🔄 开始处理Fusion数据...")
        
        # 读取CSV文件
        df = pd.read_csv(csv_file_path)
        print(f"✅ 成功读取CSV文件，共 {len(df)} 行数据")
        
        # 删除旧数据
        print("🗑️  删除旧数据...")
        Fusion.query.delete()
        db.session.commit()
        print("✅ 旧数据已删除")
        
        # 批量插入新数据
        print("📥 开始插入新数据...")
        batch_size = 100
        total_rows = len(df)
        
        for i in range(0, total_rows, batch_size):
            batch_df = df.iloc[i:i+batch_size]
            
            for idx, row in batch_df.iterrows():
                fusion_record = Fusion(
                    # 基础信息
                    fusion_name=clean_value(row.get('Fusion.Name')),
                    left_gene=clean_value(row.get('LeftGene')),
                    left_breakpoint=clean_value(row.get('LeftBreakpoint')),
                    right_gene=clean_value(row.get('RightGene')),
                    right_breakpoint=clean_value(row.get('RightBreakpoint')),
                    left_break_dinuc=clean_value(row.get('LeftBreakDinuc')),
                    right_break_dinuc=clean_value(row.get('RightBreakDinuc')),
                    annots=clean_value(row.get('annots')),
                    
                    # CDS信息
                    cds_left_id=clean_value(row.get('CDS_LEFT_ID')),
                    cds_left_range=clean_value(row.get('CDS_LEFT_RANGE')),
                    cds_right_id=clean_value(row.get('CDS_RIGHT_ID')),
                    cds_right_range=clean_value(row.get('CDS_RIGHT_RANGE')),
                    prot_fusion_type=clean_value(row.get('PROT_FUSION_TYPE')),
                    fusion_model=clean_value(row.get('FUSION_MODEL')),
                    fusion_cds=clean_value(row.get('FUSION_CDS')),
                    fusion_transl=clean_value(row.get('FUSION_TRANSL')),
                    pfam_left=clean_value(row.get('PFAM_LEFT')),
                    pfam_right=clean_value(row.get('PFAM_RIGHT')),
                    
                    # Result信息
                    result_function_left=clean_value(row.get('result.function.left')),
                    result_exon_left=clean_value(row.get('result.exon.left')),
                    result_breakpoint_left=clean_value(row.get('result.breakpoint.left')),
                    result_function_right=clean_value(row.get('result.function.right')),
                    result_exon_right=clean_value(row.get('result.exon.right')),
                    result_breakpoint_right=clean_value(row.get('result.breakpoint.right')),
                    new_fusion_name=clean_value(row.get('new.fusion.name')),
                    
                    # Transcript信息
                    transcript_left_range=clean_value(row.get('Transcript.left.range')),
                    transcript_right_range=clean_value(row.get('Transcript.right.range')),
                    transcript_length=clean_value(row.get('Transcript.length')),
                    left_cds_status=clean_value(row.get('Left.CDS.status')),
                    right_cds_status=clean_value(row.get('Right.CDS.status')),
                    transcript_left_length=clean_value(row.get('Transcript.left.length')),
                    transcript_right_length=clean_value(row.get('Transcript.right.length')),
                    
                    # Alignment信息
                    alignment_length_awt=clean_value(row.get('alignment_length_AWT')),
                    score_awt=clean_value(row.get('score_AWT')),
                    alignment_length_bwt=clean_value(row.get('alignment_length_BWT')),
                    score_bwt=clean_value(row.get('score_BWT')),
                    
                    # Sample信息
                    sample_name=clean_value(row.get('sample.name')),
                    avg_junction_read_count=clean_value(row.get('Avg.JunctionReadCount')),
                    avg_spanning_frag_count=clean_value(row.get('Avg.SpanningFragCount')),
                    avg_est_j=clean_value(row.get('Avg.est_J')),
                    avg_est_s=clean_value(row.get('Avg.est_S')),
                    avg_all_count=clean_value(row.get('Avg.all.count')),
                    avg_est_count=clean_value(row.get('Avg.est_count')),
                    avg_left_break_entropy=clean_value(row.get('Avg.LeftBreakEntropy')),
                    avg_right_break_entropy=clean_value(row.get('Avg.RightBreakEntropy')),
                    avg_found_left_exp=clean_value(row.get('Avg.found.left.exp')),
                    avg_found_right_exp=clean_value(row.get('Avg.found.right.exp')),
                    
                    # LargeAnchorSupport
                    large_anchor_support_yes=clean_value(row.get('LargeAnchorSupport.Yes')),
                    large_anchor_support_no=clean_value(row.get('LargeAnchorSupport.No')),
                    avg_ffpm=clean_value(row.get('Avg.FFPM')),
                    ffpm_lt_01_fq=clean_value(row.get('FFPM.<0.1.fq')),
                    fq=clean_value(row.get('fq')),
                    
                    # 分类信息
                    denovo=clean_value(row.get('Denovo')),
                    gdc_normal=clean_value(row.get('GDC-Normal')),
                    normal=clean_value(row.get('Normal')),
                    recurrent=clean_value(row.get('Recurrent')),
                    post_treatment=clean_value(row.get('Post-Treatment')),
                    race_asian=clean_value(row.get('Race-asian')),
                    project_ebaml=clean_value(row.get('Project-EBAML')),
                    
                    # First Event
                    first_event_censored=clean_value(row.get('First.Event.Censored')),
                    first_event_death=clean_value(row.get('First.Event.Death')),
                    first_event_death_without_remission=clean_value(row.get('First.Event.Death.Without.Remission')),
                    first_event_induction_failure=clean_value(row.get('First.Event.Induction.Failure')),
                    first_event_relapse=clean_value(row.get('First.Event.Relapse')),
                    first_event_na=clean_value(row.get('First.Event.NA')),
                    
                    # FAB分类
                    fab_m0=clean_value(row.get('FAB.M0')),
                    fab_m1=clean_value(row.get('FAB.M1')),
                    fab_m2=clean_value(row.get('FAB.M2')),
                    fab_m3=clean_value(row.get('FAB.M3')),
                    fab_m4=clean_value(row.get('FAB.M4')),
                    fab_m5=clean_value(row.get('FAB.M5')),
                    fab_m6=clean_value(row.get('FAB.M6')),
                    fab_m7=clean_value(row.get('FAB.M7')),
                    fab_nos=clean_value(row.get('FAB.NOS')),
                    fab_na=clean_value(row.get('FAB.NA')),
                    
                    # Risk Group
                    risk_group_high=clean_value(row.get('Risk.group.High')),
                    risk_group_low=clean_value(row.get('Risk.group.Low')),
                    risk_group_standard=clean_value(row.get('Risk.group.Standard')),
                    
                    # CR Status Course 1
                    cr_status_at_course1_cr=clean_value(row.get('CR.status.at.course1.Cr')),
                    cr_status_at_course1_death=clean_value(row.get('CR.status.at.course1.Death')),
                    cr_status_at_course1_not_cr=clean_value(row.get('CR.status.at.course1.Not.Cr')),
                    cr_status_at_course1_unevaluable=clean_value(row.get('CR.status.at.course1.Unevaluable')),
                    
                    # CR Status Course 2
                    cr_status_at_course2_cr=clean_value(row.get('CR.status.at.course2.Cr')),
                    cr_status_at_course2_death=clean_value(row.get('CR.status.at.course2.Death')),
                    cr_status_at_course2_not_cr=clean_value(row.get('CR.status.at.course2.Not.Cr')),
                    cr_status_at_course2_unevaluable=clean_value(row.get('CR.status.at.course2.Unevaluable')),
                    
                    # 平均值信息
                    avg_age_at_diagnosis_in_days=clean_value(row.get('Avg.Age.at.Diagnosis.in.Days')),
                    avg_event_free_survival_time_in_days=clean_value(row.get('Avg.Event.Free.Survival.Time.in.Days')),
                    avg_overall_servival_time_in_days=clean_value(row.get('Avg.Overall.Servival.Time.In.Days')),
                    avg_cytogenetic_complexity=clean_value(row.get('Avg.Cytogenetic.Complexity')),
                    avg_mrd_at_end_of_course_1=clean_value(row.get('Avg.MRD...at.end.of.course.1')),
                    avg_mrd_at_end_of_course_2=clean_value(row.get('Avg.MRD...at.end.of.course.2')),
                    
                    # 性别和生存状态
                    male=clean_value(row.get('male')),
                    female=clean_value(row.get('female')),
                    alive=clean_value(row.get('Alive')),
                    dead=clean_value(row.get('Dead')),
                    
                    # 基因突变信息
                    flt3_itd_y=clean_value(row.get('FLT3.ITD.Y')),
                    flt3_itd_n=clean_value(row.get('FLT3.ITD.N')),
                    flt3_pm_y=clean_value(row.get('FLT3.PM.Y')),
                    flt3_pm_n=clean_value(row.get('FLT3.PM.N')),
                    npm_mu_y=clean_value(row.get('NPM.mu.Y')),
                    npm_mu_n=clean_value(row.get('NPM.mu.N')),
                    cebpa_mu_y=clean_value(row.get('CEBPA.mu.Y')),
                    cebpa_mu_n=clean_value(row.get('CEBPA.mu.N')),
                    wt1_mu_y=clean_value(row.get('WT1.mu.Y')),
                    wt1_mu_n=clean_value(row.get('WT1.mu.N')),
                    c_kit_mu_exon8_y=clean_value(row.get('c.Kit.Mu.Exon8.Y')),
                    c_kit_mu_exon8_n=clean_value(row.get('c.Kit.Mu.Exon8.N')),
                    
                    # Gene A信息
                    genome_location_a=clean_value(row.get('Genome.Location.A')),
                    hallmark_a=clean_value(row.get('Hallmark.A')),
                    chr_band_a=clean_value(row.get('Chr.Band.A')),
                    somatic_a=clean_value(row.get('Somatic.A')),
                    germline_a=clean_value(row.get('Germline.A')),
                    tumour_types_somatic_a=clean_value(row.get('Tumour.Types.Somatic..A')),
                    tumour_types_germline_a=clean_value(row.get('Tumour.Types.Germline..A')),
                    cancer_syndrome_a=clean_value(row.get('Cancer.Syndrome.A')),
                    role_in_cancer_a=clean_value(row.get('Role.in.Cancer.A')),
                    mutation_types_a=clean_value(row.get('Mutation.Types.A')),
                    translocation_partner_a=clean_value(row.get('Translocation.Partner.A')),
                    other_germline_mut_a=clean_value(row.get('Other.Germline.Mut.A')),
                    other_syndrome_a=clean_value(row.get('Other.Syndrome.A')),
                    
                    # Gene B信息
                    genome_location_b=clean_value(row.get('Genome.Location.B')),
                    hallmark_b=clean_value(row.get('Hallmark.B')),
                    chr_band_b=clean_value(row.get('Chr.Band.B')),
                    somatic_b=clean_value(row.get('Somatic.B')),
                    germline_b=clean_value(row.get('Germline.B')),
                    tumour_types_somatic_b=clean_value(row.get('Tumour.Types.Somatic..B')),
                    tumour_types_germline_b=clean_value(row.get('Tumour.Types.Germline..B')),
                    cancer_syndrome_b=clean_value(row.get('Cancer.Syndrome.B')),
                    role_in_cancer_b=clean_value(row.get('Role.in.Cancer.B')),
                    mutation_types_b=clean_value(row.get('Mutation.Types.B')),
                    translocation_partner_b=clean_value(row.get('Translocation.Partner.B')),
                    other_germline_mut_b=clean_value(row.get('Other.Germline.Mut.B')),
                    other_syndrome_b=clean_value(row.get('Other.Syndrome.B')),
                    
                    # Protein A信息
                    protein_names_a=clean_value(row.get('Protein.names.A')),
                    gene_names_a=clean_value(row.get('Gene.Names.A')),
                    polymorphism_a=clean_value(row.get('Polymorphism.A')),
                    dna_binding_a=clean_value(row.get('DNA.binding.A')),
                    pathway_a=clean_value(row.get('Pathway.A')),
                    site_a=clean_value(row.get('Site.A')),
                    function_cc_a=clean_value(row.get('Function..CC..A')),
                    activity_regulation_a=clean_value(row.get('Activity.regulation.A')),
                    cofactor_a=clean_value(row.get('Cofactor.A')),
                    binding_site_a=clean_value(row.get('Binding.site.A')),
                    protein_existence_a=clean_value(row.get('Protein.existence.A')),
                    features_a=clean_value(row.get('Features.A')),
                    subunit_structure_a=clean_value(row.get('Subunit.structure.A')),
                    developmental_stage_a=clean_value(row.get('Developmental.stage.A')),
                    induction_a=clean_value(row.get('Induction.A')),
                    tissue_specificity_a=clean_value(row.get('Tissue.specificity.A')),
                    gene_ontology_go_a=clean_value(row.get('Gene.Ontology..GO..A')),
                    involvement_in_disease_a=clean_value(row.get('Involvement.in.disease.A')),
                    mutagenesis_a=clean_value(row.get('Mutagenesis.A')),
                    pharmaceutical_use_a=clean_value(row.get('Pharmaceutical.use.A')),
                    intramembrane_a=clean_value(row.get('Intramembrane.A')),
                    subcellular_location_cc_a=clean_value(row.get('Subcellular.location..CC..A')),
                    post_translational_modification_a=clean_value(row.get('Post.translational.modification.A')),
                    date_of_last_modification_a=clean_value(row.get('Date.of.last.modification.A')),
                    domain_cc_a=clean_value(row.get('Domain..CC..A')),
                    protein_families_a=clean_value(row.get('Protein.families.A')),
                    sequence_similarities_a=clean_value(row.get('Sequence.similarities.A')),
                    
                    # Protein B信息
                    protein_names_b=clean_value(row.get('Protein.names.B')),
                    gene_names_b=clean_value(row.get('Gene.Names.B')),
                    polymorphism_b=clean_value(row.get('Polymorphism.B')),
                    dna_binding_b=clean_value(row.get('DNA.binding.B')),
                    pathway_b=clean_value(row.get('Pathway.B')),
                    site_b=clean_value(row.get('Site.B')),
                    function_cc_b=clean_value(row.get('Function..CC..B')),
                    activity_regulation_b=clean_value(row.get('Activity.regulation.B')),
                    cofactor_b=clean_value(row.get('Cofactor.B')),
                    binding_site_b=clean_value(row.get('Binding.site.B')),
                    protein_existence_b=clean_value(row.get('Protein.existence.B')),
                    features_b=clean_value(row.get('Features.B')),
                    subunit_structure_b=clean_value(row.get('Subunit.structure.B')),
                    developmental_stage_b=clean_value(row.get('Developmental.stage.B')),
                    induction_b=clean_value(row.get('Induction.B')),
                    tissue_specificity_b=clean_value(row.get('Tissue.specificity.B')),
                    gene_ontology_go_b=clean_value(row.get('Gene.Ontology..GO..B')),
                    involvement_in_disease_b=clean_value(row.get('Involvement.in.disease.B')),
                    mutagenesis_b=clean_value(row.get('Mutagenesis.B')),
                    pharmaceutical_use_b=clean_value(row.get('Pharmaceutical.use.B')),
                    intramembrane_b=clean_value(row.get('Intramembrane.B')),
                    subcellular_location_cc_b=clean_value(row.get('Subcellular.location..CC..B')),
                    post_translational_modification_b=clean_value(row.get('Post.translational.modification.B')),
                    date_of_last_modification_b=clean_value(row.get('Date.of.last.modification.B')),
                    domain_cc_b=clean_value(row.get('Domain..CC..B')),
                    protein_families_b=clean_value(row.get('Protein.families.B')),
                    sequence_similarities_b=clean_value(row.get('Sequence.similarities.B'))
                )
                
                db.session.add(fusion_record)
            
            db.session.commit()
            print(f"✅ 已插入 {min(i+batch_size, total_rows)}/{total_rows} 条数据")
        
        print("🎉 Fusion数据上传完成！")
        
        # 查询统计
        total_count = Fusion.query.count()
        print(f"📊 数据库中共有 {total_count} 条Fusion记录")


def upload_fusionall_data(csv_file_path):
    """上传FusionAll数据到数据库"""
    app = create_app()
    
    with app.app_context():
        print("🔄 开始处理FusionAll数据...")
        
        # 读取CSV文件
        df = pd.read_csv(csv_file_path)
        print(f"✅ 成功读取CSV文件，共 {len(df)} 行数据")
        
        # 删除旧数据
        print("🗑️  删除旧数据...")
        FusionAll.query.delete()
        db.session.commit()
        print("✅ 旧数据已删除")
        
        # 批量插入新数据
        print("📥 开始插入新数据...")
        batch_size = 100
        total_rows = len(df)
        
        for i in range(0, total_rows, batch_size):
            batch_df = df.iloc[i:i+batch_size]
            
            for idx, row in batch_df.iterrows():
                fusionall_record = FusionAll(
                    x_fusion_name=clean_value(row.get('X.FusionName')),
                    junction_read_count=clean_value(row.get('JunctionReadCount')),
                    spanning_frag_count=clean_value(row.get('SpanningFragCount')),
                    est_j=clean_value(row.get('est_J')),
                    est_s=clean_value(row.get('est_S')),
                    splice_type=clean_value(row.get('SpliceType')),
                    left_gene=clean_value(row.get('LeftGene')),
                    left_breakpoint=clean_value(row.get('LeftBreakpoint')),
                    right_gene=clean_value(row.get('RightGene')),
                    right_breakpoint=clean_value(row.get('RightBreakpoint')),
                    large_anchor_support=clean_value(row.get('LargeAnchorSupport')),
                    left_break_dinuc=clean_value(row.get('LeftBreakDinuc')),
                    left_break_entropy=clean_value(row.get('LeftBreakEntropy')),
                    right_break_dinuc=clean_value(row.get('RightBreakDinuc')),
                    right_break_entropy=clean_value(row.get('RightBreakEntropy')),
                    annots=clean_value(row.get('annots')),
                    cds_left_id=clean_value(row.get('CDS_LEFT_ID')),
                    cds_left_range=clean_value(row.get('CDS_LEFT_RANGE')),
                    cds_right_id=clean_value(row.get('CDS_RIGHT_ID')),
                    cds_right_range=clean_value(row.get('CDS_RIGHT_RANGE')),
                    prot_fusion_type=clean_value(row.get('PROT_FUSION_TYPE')),
                    fusion_model=clean_value(row.get('FUSION_MODEL')),
                    fusion_cds=clean_value(row.get('FUSION_CDS')),
                    fusion_transl=clean_value(row.get('FUSION_TRANSL')),
                    pfam_left=clean_value(row.get('PFAM_LEFT')),
                    pfam_right=clean_value(row.get('PFAM_RIGHT')),
                    all_count=clean_value(row.get('all.count')),
                    sample_name=clean_value(row.get('sample.name')),
                    result_function_left=clean_value(row.get('result.function.left')),
                    result_exon_left=clean_value(row.get('result.exon.left')),
                    result_breakpoint_left=clean_value(row.get('result.breakpoint.left')),
                    result_function_right=clean_value(row.get('result.function.right')),
                    result_exon_right=clean_value(row.get('result.exon.right')),
                    result_breakpoint_right=clean_value(row.get('result.breakpoint.right')),
                    new_fusion_name=clean_value(row.get('new.fusion.name')),
                    transcript_left_range=clean_value(row.get('Transcript.left.range')),
                    transcript_right_range=clean_value(row.get('Transcript.right.range')),
                    transcript_length=clean_value(row.get('Transcript.length')),
                    left_cds_status=clean_value(row.get('Left.CDS.status')),
                    right_cds_status=clean_value(row.get('Right.CDS.status')),
                    transcript_left_length=clean_value(row.get('Transcript.left.length')),
                    transcript_right_length=clean_value(row.get('Transcript.right.length')),
                    alignment_length_awt=clean_value(row.get('alignment_length_AWT')),
                    score_awt=clean_value(row.get('score_AWT')),
                    alignment_length_bwt=clean_value(row.get('alignment_length_BWT')),
                    score_bwt=clean_value(row.get('score_BWT')),
                    est_count=clean_value(row.get('est_count')),
                    found_left_exp=clean_value(row.get('found.left.exp')),
                    found_right_exp=clean_value(row.get('found.right.exp')),
                    ffpm_cal=clean_value(row.get('FFPM.cal'))
                )
                
                db.session.add(fusionall_record)
            
            db.session.commit()
            print(f"✅ 已插入 {min(i+batch_size, total_rows)}/{total_rows} 条数据")
        
        print("🎉 FusionAll数据上传完成！")
        
        # 查询统计
        total_count = FusionAll.query.count()
        print(f"📊 数据库中共有 {total_count} 条FusionAll记录")


if __name__ == '__main__':
    import sys
    
    if len(sys.argv) < 2:
        print("使用方法：")
        print("  上传Fusion数据: python upload_fusion.py fusion path/to/fusion.csv")
        print("  上传FusionAll数据: python upload_fusion.py fusionall path/to/fusionall.csv")
    else:
        data_type = sys.argv[1]
        csv_path = sys.argv[2] if len(sys.argv) > 2 else 'fusion.csv'
        
        if data_type == 'fusion':
            upload_fusion_data(csv_path)
        elif data_type == 'fusionall':
            upload_fusionall_data(csv_path)
        else:
            print(f"❌ 未知的数据类型: {data_type}")
            print("请使用 'fusion' 或 'fusionall'")