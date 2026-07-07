# backend/models.py
from extensions import db
from datetime import datetime

class User(db.Model):
    __tablename__ = 'users'
    id = db.Column(db.Integer, primary_key=True)
    username = db.Column(db.String(80), unique=True, nullable=False)
    password_hash = db.Column(db.String(255), nullable=False)
    role = db.Column(db.String(20), nullable=False, default='user')
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

class Fusion(db.Model):
    __tablename__ = 'fusion'
    id = db.Column(db.Integer, primary_key=True, autoincrement=True)
    
    # 基础信息
    fusion_name = db.Column(db.String(255), name='Fusion.Name')
    left_gene = db.Column(db.String(100), name='LeftGene')
    left_breakpoint = db.Column(db.String(255), name='LeftBreakpoint')
    right_gene = db.Column(db.String(100), name='RightGene')
    right_breakpoint = db.Column(db.String(255), name='RightBreakpoint')
    left_break_dinuc = db.Column(db.String(10), name='LeftBreakDinuc')
    right_break_dinuc = db.Column(db.String(10), name='RightBreakDinuc')
    annots = db.Column(db.Text, name='annots')
    
    # CDS信息
    cds_left_id = db.Column(db.String(255), name='CDS_LEFT_ID')
    cds_left_range = db.Column(db.String(255), name='CDS_LEFT_RANGE')
    cds_right_id = db.Column(db.String(255), name='CDS_RIGHT_ID')
    cds_right_range = db.Column(db.String(255), name='CDS_RIGHT_RANGE')
    prot_fusion_type = db.Column(db.String(100), name='PROT_FUSION_TYPE')
    fusion_model = db.Column(db.Text, name='FUSION_MODEL')
    fusion_cds = db.Column(db.Text, name='FUSION_CDS')
    fusion_transl = db.Column(db.Text, name='FUSION_TRANSL')
    pfam_left = db.Column(db.Text, name='PFAM_LEFT')
    pfam_right = db.Column(db.Text, name='PFAM_RIGHT')
    
    # Result信息
    result_function_left = db.Column(db.String(255), name='result.function.left')
    result_exon_left = db.Column(db.String(255), name='result.exon.left')
    result_breakpoint_left = db.Column(db.String(255), name='result.breakpoint.left')
    result_function_right = db.Column(db.String(255), name='result.function.right')
    result_exon_right = db.Column(db.String(255), name='result.exon.right')
    result_breakpoint_right = db.Column(db.String(255), name='result.breakpoint.right')
    new_fusion_name = db.Column(db.String(255), name='new.fusion.name')
    
    # Transcript信息
    transcript_left_range = db.Column(db.String(255), name='Transcript.left.range')
    transcript_right_range = db.Column(db.String(255), name='Transcript.right.range')
    transcript_length = db.Column(db.Float, name='Transcript.length')
    left_cds_status = db.Column(db.String(100), name='Left.CDS.status')
    right_cds_status = db.Column(db.String(100), name='Right.CDS.status')
    transcript_left_length = db.Column(db.Integer, name='Transcript.left.length')
    transcript_right_length = db.Column(db.Integer, name='Transcript.right.length')
    
    # Alignment信息
    alignment_length_awt = db.Column(db.Integer, name='alignment_length_AWT')
    score_awt = db.Column(db.Float, name='score_AWT')
    alignment_length_bwt = db.Column(db.Integer, name='alignment_length_BWT')
    score_bwt = db.Column(db.Float, name='score_BWT')
    
    # Sample信息
    sample_name = db.Column(db.String(255), name='sample.name')
    avg_junction_read_count = db.Column(db.Float, name='Avg.JunctionReadCount')
    avg_spanning_frag_count = db.Column(db.Float, name='Avg.SpanningFragCount')
    avg_est_j = db.Column(db.Float, name='Avg.est_J')
    avg_est_s = db.Column(db.Float, name='Avg.est_S')
    avg_all_count = db.Column(db.Float, name='Avg.all.count')
    avg_est_count = db.Column(db.Float, name='Avg.est_count')
    avg_left_break_entropy = db.Column(db.Float, name='Avg.LeftBreakEntropy')
    avg_right_break_entropy = db.Column(db.Float, name='Avg.RightBreakEntropy')
    avg_found_left_exp = db.Column(db.Float, name='Avg.found.left.exp')
    avg_found_right_exp = db.Column(db.Float, name='Avg.found.right.exp')
    
    # LargeAnchorSupport
    large_anchor_support_yes = db.Column(db.Integer, name='LargeAnchorSupport.Yes')
    large_anchor_support_no = db.Column(db.Integer, name='LargeAnchorSupport.No')
    avg_ffpm = db.Column(db.Float, name='Avg.FFPM')
    ffpm_lt_01_fq = db.Column(db.Integer, name='FFPM.<0.1.fq')
    fq = db.Column(db.Integer, name='fq')
    
    # 分类信息
    denovo = db.Column(db.Integer, name='Denovo')
    gdc_normal = db.Column(db.Integer, name='GDC-Normal')
    normal = db.Column(db.Integer, name='Normal')
    recurrent = db.Column(db.Integer, name='Recurrent')
    post_treatment = db.Column(db.Integer, name='Post-Treatment')
    race_asian = db.Column(db.Integer, name='Race-asian')
    project_ebaml = db.Column(db.Integer, name='Project-EBAML')
    
    # First Event
    first_event_censored = db.Column(db.Integer, name='First.Event.Censored')
    first_event_death = db.Column(db.Integer, name='First.Event.Death')
    first_event_death_without_remission = db.Column(db.Integer, name='First.Event.Death.Without.Remission')
    first_event_induction_failure = db.Column(db.Integer, name='First.Event.Induction.Failure')
    first_event_relapse = db.Column(db.Integer, name='First.Event.Relapse')
    first_event_na = db.Column(db.Integer, name='First.Event.NA')
    
    # FAB分类
    fab_m0 = db.Column(db.Integer, name='FAB.M0')
    fab_m1 = db.Column(db.Integer, name='FAB.M1')
    fab_m2 = db.Column(db.Integer, name='FAB.M2')
    fab_m3 = db.Column(db.Integer, name='FAB.M3')
    fab_m4 = db.Column(db.Integer, name='FAB.M4')
    fab_m5 = db.Column(db.Integer, name='FAB.M5')
    fab_m6 = db.Column(db.Integer, name='FAB.M6')
    fab_m7 = db.Column(db.Integer, name='FAB.M7')
    fab_nos = db.Column(db.Integer, name='FAB.NOS')
    fab_na = db.Column(db.Integer, name='FAB.NA')
    
    # Risk Group
    risk_group_high = db.Column(db.Integer, name='Risk.group.High')
    risk_group_low = db.Column(db.Integer, name='Risk.group.Low')
    risk_group_standard = db.Column(db.Integer, name='Risk.group.Standard')
    
    # CR Status Course 1
    cr_status_at_course1_cr = db.Column(db.Integer, name='CR.status.at.course1.Cr')
    cr_status_at_course1_death = db.Column(db.Integer, name='CR.status.at.course1.Death')
    cr_status_at_course1_not_cr = db.Column(db.Integer, name='CR.status.at.course1.Not.Cr')
    cr_status_at_course1_unevaluable = db.Column(db.Integer, name='CR.status.at.course1.Unevaluable')
    
    # CR Status Course 2
    cr_status_at_course2_cr = db.Column(db.Integer, name='CR.status.at.course2.Cr')
    cr_status_at_course2_death = db.Column(db.Integer, name='CR.status.at.course2.Death')
    cr_status_at_course2_not_cr = db.Column(db.Integer, name='CR.status.at.course2.Not.Cr')
    cr_status_at_course2_unevaluable = db.Column(db.Integer, name='CR.status.at.course2.Unevaluable')
    
    # 平均值信息
    avg_age_at_diagnosis_in_days = db.Column(db.String(100), name='Avg.Age.at.Diagnosis.in.Days')
    avg_event_free_survival_time_in_days = db.Column(db.String(100), name='Avg.Event.Free.Survival.Time.in.Days')
    avg_overall_servival_time_in_days = db.Column(db.String(100), name='Avg.Overall.Servival.Time.In.Days')
    avg_cytogenetic_complexity = db.Column(db.String(100), name='Avg.Cytogenetic.Complexity')
    avg_mrd_at_end_of_course_1 = db.Column(db.String(100), name='Avg.MRD...at.end.of.course.1')
    avg_mrd_at_end_of_course_2 = db.Column(db.String(100), name='Avg.MRD...at.end.of.course.2')
    
    # 性别和生存状态
    male = db.Column(db.Integer, name='male')
    female = db.Column(db.Integer, name='female')
    alive = db.Column(db.Integer, name='Alive')
    dead = db.Column(db.Integer, name='Dead')
    
    # 基因突变信息
    flt3_itd_y = db.Column(db.Integer, name='FLT3.ITD.Y')
    flt3_itd_n = db.Column(db.Integer, name='FLT3.ITD.N')
    flt3_pm_y = db.Column(db.Integer, name='FLT3.PM.Y')
    flt3_pm_n = db.Column(db.Integer, name='FLT3.PM.N')
    npm_mu_y = db.Column(db.Integer, name='NPM.mu.Y')
    npm_mu_n = db.Column(db.Integer, name='NPM.mu.N')
    cebpa_mu_y = db.Column(db.Integer, name='CEBPA.mu.Y')
    cebpa_mu_n = db.Column(db.Integer, name='CEBPA.mu.N')
    wt1_mu_y = db.Column(db.Integer, name='WT1.mu.Y')
    wt1_mu_n = db.Column(db.Integer, name='WT1.mu.N')
    c_kit_mu_exon8_y = db.Column(db.Integer, name='c.Kit.Mu.Exon8.Y')
    c_kit_mu_exon8_n = db.Column(db.Integer, name='c.Kit.Mu.Exon8.N')
    
    # Gene A信息 - ✅ 已修复数据类型
    genome_location_a = db.Column(db.String(255), name='Genome.Location.A')
    hallmark_a = db.Column(db.Text, name='Hallmark.A')
    chr_band_a = db.Column(db.String(100), name='Chr.Band.A')
    somatic_a = db.Column(db.String(100), name='Somatic.A')
    germline_a = db.Column(db.String(255), name='Germline.A')  # ✅ Float → String
    tumour_types_somatic_a = db.Column(db.Text, name='Tumour.Types.Somatic..A')
    tumour_types_germline_a = db.Column(db.Text, name='Tumour.Types.Germline..A')  # ✅ Float → Text
    cancer_syndrome_a = db.Column(db.String(255), name='Cancer.Syndrome.A')  # ✅ Float → String
    role_in_cancer_a = db.Column(db.Text, name='Role.in.Cancer.A')
    mutation_types_a = db.Column(db.Text, name='Mutation.Types.A')
    translocation_partner_a = db.Column(db.Text, name='Translocation.Partner.A')
    other_germline_mut_a = db.Column(db.String(255), name='Other.Germline.Mut.A')  # ✅ Float → String
    other_syndrome_a = db.Column(db.String(255), name='Other.Syndrome.A')  # ✅ Float → String
    
    # Gene B信息 - ✅ 已修复数据类型
    genome_location_b = db.Column(db.String(255), name='Genome.Location.B')
    hallmark_b = db.Column(db.Text, name='Hallmark.B')
    chr_band_b = db.Column(db.String(100), name='Chr.Band.B')
    somatic_b = db.Column(db.String(100), name='Somatic.B')
    germline_b = db.Column(db.String(100), name='Germline.B')
    tumour_types_somatic_b = db.Column(db.Text, name='Tumour.Types.Somatic..B')
    tumour_types_germline_b = db.Column(db.String(100), name='Tumour.Types.Germline..B')
    cancer_syndrome_b = db.Column(db.String(255), name='Cancer.Syndrome.B')  # ✅ Float → String
    role_in_cancer_b = db.Column(db.Text, name='Role.in.Cancer.B')
    mutation_types_b = db.Column(db.Text, name='Mutation.Types.B')
    translocation_partner_b = db.Column(db.Text, name='Translocation.Partner.B')
    other_germline_mut_b = db.Column(db.String(100), name='Other.Germline.Mut.B')
    other_syndrome_b = db.Column(db.String(100), name='Other.Syndrome.B')
    
    # Protein A信息 - ✅ 已修复数据类型
    protein_names_a = db.Column(db.Text, name='Protein.names.A')
    gene_names_a = db.Column(db.String(255), name='Gene.Names.A')
    polymorphism_a = db.Column(db.Text, name='Polymorphism.A')
    dna_binding_a = db.Column(db.String(255), name='DNA.binding.A')  # ✅ Float → String
    pathway_a = db.Column(db.Text, name='Pathway.A')
    site_a = db.Column(db.Text, name='Site.A')
    function_cc_a = db.Column(db.Text, name='Function..CC..A')
    activity_regulation_a = db.Column(db.Text, name='Activity.regulation.A')
    cofactor_a = db.Column(db.Text, name='Cofactor.A')
    binding_site_a = db.Column(db.Text, name='Binding.site.A')
    protein_existence_a = db.Column(db.String(255), name='Protein.existence.A')
    features_a = db.Column(db.Text, name='Features.A')
    subunit_structure_a = db.Column(db.Text, name='Subunit.structure.A')
    developmental_stage_a = db.Column(db.Text, name='Developmental.stage.A')
    induction_a = db.Column(db.Text, name='Induction.A')
    tissue_specificity_a = db.Column(db.Text, name='Tissue.specificity.A')
    gene_ontology_go_a = db.Column(db.Text, name='Gene.Ontology..GO..A')
    involvement_in_disease_a = db.Column(db.Text, name='Involvement.in.disease.A')
    mutagenesis_a = db.Column(db.Text, name='Mutagenesis.A')
    pharmaceutical_use_a = db.Column(db.Text, name='Pharmaceutical.use.A')
    intramembrane_a = db.Column(db.String(255), name='Intramembrane.A')  # ✅ Float → String
    subcellular_location_cc_a = db.Column(db.Text, name='Subcellular.location..CC..A')
    post_translational_modification_a = db.Column(db.Text, name='Post.translational.modification.A')
    date_of_last_modification_a = db.Column(db.String(100), name='Date.of.last.modification.A')
    domain_cc_a = db.Column(db.Text, name='Domain..CC..A')
    protein_families_a = db.Column(db.Text, name='Protein.families.A')
    sequence_similarities_a = db.Column(db.Text, name='Sequence.similarities.A')
    
    # Protein B信息 - ✅ 已修复数据类型
    protein_names_b = db.Column(db.Text, name='Protein.names.B')
    gene_names_b = db.Column(db.String(255), name='Gene.Names.B')
    polymorphism_b = db.Column(db.Text, name='Polymorphism.B')
    dna_binding_b = db.Column(db.String(255), name='DNA.binding.B')
    pathway_b = db.Column(db.Text, name='Pathway.B')
    site_b = db.Column(db.Text, name='Site.B')
    function_cc_b = db.Column(db.Text, name='Function..CC..B')
    activity_regulation_b = db.Column(db.Text, name='Activity.regulation.B')
    cofactor_b = db.Column(db.Text, name='Cofactor.B')
    binding_site_b = db.Column(db.Text, name='Binding.site.B')
    protein_existence_b = db.Column(db.String(255), name='Protein.existence.B')
    features_b = db.Column(db.Text, name='Features.B')
    subunit_structure_b = db.Column(db.Text, name='Subunit.structure.B')
    developmental_stage_b = db.Column(db.Text, name='Developmental.stage.B')
    induction_b = db.Column(db.Text, name='Induction.B')
    tissue_specificity_b = db.Column(db.Text, name='Tissue.specificity.B')
    gene_ontology_go_b = db.Column(db.Text, name='Gene.Ontology..GO..B')
    involvement_in_disease_b = db.Column(db.Text, name='Involvement.in.disease.B')
    mutagenesis_b = db.Column(db.Text, name='Mutagenesis.B')
    pharmaceutical_use_b = db.Column(db.String(255), name='Pharmaceutical.use.B')  # ✅ Float → String
    intramembrane_b = db.Column(db.String(255), name='Intramembrane.B')
    subcellular_location_cc_b = db.Column(db.Text, name='Subcellular.location..CC..B')
    post_translational_modification_b = db.Column(db.Text, name='Post.translational.modification.B')
    date_of_last_modification_b = db.Column(db.String(100), name='Date.of.last.modification.B')
    domain_cc_b = db.Column(db.Text, name='Domain..CC..B')
    protein_families_b = db.Column(db.Text, name='Protein.families.B')
    sequence_similarities_b = db.Column(db.Text, name='Sequence.similarities.B')
    
    created_at = db.Column(db.DateTime, default=datetime.utcnow)


class FusionAll(db.Model):
    __tablename__ = 'fusion_all'
    id = db.Column(db.Integer, primary_key=True, autoincrement=True)
    
    # FusionAll 完整字段（50列）
    x_fusion_name = db.Column(db.String(255), name='X.FusionName')
    junction_read_count = db.Column(db.Float, name='JunctionReadCount')
    spanning_frag_count = db.Column(db.Float, name='SpanningFragCount')
    est_j = db.Column(db.Float, name='est_J')
    est_s = db.Column(db.Float, name='est_S')
    splice_type = db.Column(db.String(100), name='SpliceType')
    left_gene = db.Column(db.String(100), name='LeftGene')
    left_breakpoint = db.Column(db.String(255), name='LeftBreakpoint')
    right_gene = db.Column(db.String(100), name='RightGene')
    right_breakpoint = db.Column(db.String(255), name='RightBreakpoint')
    large_anchor_support = db.Column(db.String(50), name='LargeAnchorSupport')
    left_break_dinuc = db.Column(db.String(10), name='LeftBreakDinuc')
    left_break_entropy = db.Column(db.Float, name='LeftBreakEntropy')
    right_break_dinuc = db.Column(db.String(10), name='RightBreakDinuc')
    right_break_entropy = db.Column(db.Float, name='RightBreakEntropy')
    annots = db.Column(db.Text, name='annots')
    cds_left_id = db.Column(db.String(255), name='CDS_LEFT_ID')
    cds_left_range = db.Column(db.String(255), name='CDS_LEFT_RANGE')
    cds_right_id = db.Column(db.String(255), name='CDS_RIGHT_ID')
    cds_right_range = db.Column(db.String(255), name='CDS_RIGHT_RANGE')
    prot_fusion_type = db.Column(db.String(100), name='PROT_FUSION_TYPE')
    fusion_model = db.Column(db.Text, name='FUSION_MODEL')
    fusion_cds = db.Column(db.Text, name='FUSION_CDS')
    fusion_transl = db.Column(db.Text, name='FUSION_TRANSL')
    pfam_left = db.Column(db.Text, name='PFAM_LEFT')
    pfam_right = db.Column(db.Text, name='PFAM_RIGHT')
    all_count = db.Column(db.Float, name='all.count')
    sample_name = db.Column(db.String(255), name='sample.name')
    result_function_left = db.Column(db.String(255), name='result.function.left')
    result_exon_left = db.Column(db.String(255), name='result.exon.left')
    result_breakpoint_left = db.Column(db.String(255), name='result.breakpoint.left')
    result_function_right = db.Column(db.String(255), name='result.function.right')
    result_exon_right = db.Column(db.String(255), name='result.exon.right')
    result_breakpoint_right = db.Column(db.String(255), name='result.breakpoint.right')
    new_fusion_name = db.Column(db.String(255), name='new.fusion.name')
    transcript_left_range = db.Column(db.String(255), name='Transcript.left.range')
    transcript_right_range = db.Column(db.String(255), name='Transcript.right.range')
    transcript_length = db.Column(db.Float, name='Transcript.length')
    left_cds_status = db.Column(db.String(100), name='Left.CDS.status')
    right_cds_status = db.Column(db.String(100), name='Right.CDS.status')
    transcript_left_length = db.Column(db.Integer, name='Transcript.left.length')
    transcript_right_length = db.Column(db.Integer, name='Transcript.right.length')
    alignment_length_awt = db.Column(db.Integer, name='alignment_length_AWT')
    score_awt = db.Column(db.Float, name='score_AWT')
    alignment_length_bwt = db.Column(db.Integer, name='alignment_length_BWT')
    score_bwt = db.Column(db.Float, name='score_BWT')
    est_count = db.Column(db.Float, name='est_count')
    found_left_exp = db.Column(db.Float, name='found.left.exp')
    found_right_exp = db.Column(db.Float, name='found.right.exp')
    ffpm_cal = db.Column(db.Float, name='FFPM.cal')
    filter_col = db.Column(db.String(255), name='Filter')
    
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

