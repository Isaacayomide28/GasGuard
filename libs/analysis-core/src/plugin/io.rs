use super::interface::Finding;

// ---------------------------------------------------------------------------
// Standard Input
// ---------------------------------------------------------------------------

/// Everything a rule receives when analysing a single file.
#[derive(Debug, Clone)]
pub struct AnalysisInput {
    /// Absolute or workspace-relative file path.
    pub file_path: String,
    /// Full UTF-8 source content.
    pub source: String,
    /// Parsed AST represented as a JSON value (optional – rules that don't
    /// need an AST may ignore this field).
    pub ast: Option<serde_json::Value>,
    /// Arbitrary metadata (e.g. compiler version, import graph).
    pub metadata: std::collections::HashMap<String, String>,
}

impl AnalysisInput {
    pub fn new(file_path: impl Into<String>, source: impl Into<String>) -> Self {
        Self {
            file_path: file_path.into(),
            source: source.into(),
            ast: None,
            metadata: Default::default(),
        }
    }

    pub fn with_ast(mut self, ast: serde_json::Value) -> Self {
        self.ast = Some(ast);
        self
    }

    pub fn with_meta(mut self, key: impl Into<String>, value: impl Into<String>) -> Self {
        self.metadata.insert(key.into(), value.into());
        self
    }
}

// ---------------------------------------------------------------------------
// Standard Output
// ---------------------------------------------------------------------------

/// The structured result produced after running one rule on one file.
#[derive(Debug, Clone)]
pub struct AnalysisOutput {
    /// Which rule produced this output.
    pub rule_id: String,
    /// File that was analysed.
    pub file_path: String,
    /// All findings discovered.
    pub findings: Vec<Finding>,
    /// Whether the rule completed successfully.
    pub success: bool,
    /// Optional diagnostic message when `success == false`.
    pub error: Option<String>,
}

impl AnalysisOutput {
    pub fn ok(
        rule_id: impl Into<String>,
        file_path: impl Into<String>,
        findings: Vec<Finding>,
    ) -> Self {
        Self {
            rule_id: rule_id.into(),
            file_path: file_path.into(),
            findings,
            success: true,
            error: None,
        }
    }

    pub fn err(
        rule_id: impl Into<String>,
        file_path: impl Into<String>,
        msg: impl Into<String>,
    ) -> Self {
        Self {
            rule_id: rule_id.into(),
            file_path: file_path.into(),
            findings: vec![],
            success: false,
            error: Some(msg.into()),
        }
    }

    /// Convenience: true when there are no findings.
    pub fn is_clean(&self) -> bool {
        self.findings.is_empty()
    }
}

// ---------------------------------------------------------------------------
// Session-level aggregate output
// ---------------------------------------------------------------------------

/// Collected results for an entire analysis session.
#[derive(Debug, Default)]
pub struct SessionOutput {
    pub outputs: Vec<AnalysisOutput>,
}

impl SessionOutput {
    pub fn push(&mut self, output: AnalysisOutput) {
        self.outputs.push(output);
    }

    /// Flatten all findings across every file and rule, sorted deterministically.
    pub fn all_findings(&self) -> Vec<&Finding> {
        let mut findings: Vec<&Finding> = self.outputs.iter().flat_map(|o| &o.findings).collect();
        findings.sort_by(|a, b| {
            a.file
                .cmp(&b.file)
                .then(a.line.cmp(&b.line))
                .then(a.rule_id.cmp(&b.rule_id))
        });
        findings
    }

    /// Total number of findings.
    pub fn finding_count(&self) -> usize {
        self.outputs.iter().map(|o| o.findings.len()).sum()
    }

    /// `true` when every output succeeded with zero findings.
    pub fn is_clean(&self) -> bool {
        self.outputs.iter().all(|o| o.is_clean() && o.success)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn make_finding(rule_id: &str, file: &str, line: u32) -> Finding {
        Finding {
            rule_id: rule_id.to_string(),
            severity: Severity::Warning,
            message: "test".to_string(),
            file: file.to_string(),
            line,
            column: None,
            suggestion: None,
        }
    }

    #[test]
    fn all_findings_sorted_deterministically() {
        let mut session = SessionOutput::default();
        session.push(AnalysisOutput::ok("B-002", "z.sol", vec![make_finding("R2", "z.sol", 10)]));
        session.push(AnalysisOutput::ok("A-001", "a.sol", vec![make_finding("R1", "a.sol", 5)]));
        session.push(AnalysisOutput::ok("B-001", "a.sol", vec![make_finding("R3", "a.sol", 3)]));

        let findings = session.all_findings();
        assert_eq!(findings.len(), 3);
        // Should be sorted by file, then line, then rule_id
        assert_eq!(findings[0].file, "a.sol");
        assert_eq!(findings[0].line, 3);
        assert_eq!(findings[1].file, "a.sol");
        assert_eq!(findings[1].line, 5);
        assert_eq!(findings[2].file, "z.sol");
        assert_eq!(findings[2].line, 10);
    }

    #[test]
    fn all_findings_stable_across_multiple_calls() {
        let mut session = SessionOutput::default();
        for i in 0..20 {
            session.push(AnalysisOutput::ok(
                &format!("R-{}", i % 5),
                &format!("file-{}.sol", i % 3),
                vec![make_finding(&format!("R-{}", i % 5), &format!("file-{}.sol", i % 3), (i * 7) as u32)],
            ));
        }

        let first = session.all_findings();
        let second = session.all_findings();
        let first_keys: Vec<_> = first.iter().map(|f| (&f.file, f.line, &f.rule_id)).collect();
        let second_keys: Vec<_> = second.iter().map(|f| (&f.file, f.line, &f.rule_id)).collect();
        assert_eq!(first_keys, second_keys);
    }
}
