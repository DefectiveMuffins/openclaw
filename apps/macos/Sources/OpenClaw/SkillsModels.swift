import Foundation
import OpenClawProtocol

struct SkillsStatusReport: Codable {
    let workspaceDir: String
    let managedSkillsDir: String
    let skills: [SkillStatus]
}

struct SkillStatus: Codable, Identifiable {
    let name: String
    let description: String
    let source: String
    let filePath: String
    let baseDir: String
    let skillKey: String
    let primaryEnv: String?
    let emoji: String?
    let homepage: String?
    let always: Bool
    let disabled: Bool
    let blockedByAllowlist: Bool? = false
    let quarantined: Bool = false
    let auditStatus: String = "not_applicable"
    let auditSummary: SkillAuditSummary?
    let lastScannedAt: Int?
    let trustReason: String = "bundled"
    let eligible: Bool
    let requirements: SkillRequirements
    let missing: SkillMissing
    let configChecks: [SkillStatusConfigCheck]
    let install: [SkillInstallOption]

    var id: String {
        self.name
    }
}

struct SkillRequirements: Codable {
    let bins: [String]
    let anyBins: [String] = []
    let env: [String]
    let config: [String]
    let os: [String] = []
}

struct SkillMissing: Codable {
    let bins: [String]
    let anyBins: [String] = []
    let env: [String]
    let config: [String]
    let os: [String] = []
}

struct SkillStatusConfigCheck: Codable, Identifiable {
    let path: String
    let value: AnyCodable?
    let satisfied: Bool

    var id: String {
        self.path
    }
}

struct SkillInstallOption: Codable, Identifiable {
    let id: String
    let kind: String
    let label: String
    let bins: [String]
}

struct SkillInstallResult: Codable {
    let ok: Bool
    let message: String
    let stdout: String?
    let stderr: String?
    let code: Int?
    let warnings: [String]?
    let audit: SkillAuditSnapshot?
}

struct SkillUpdateResult: Codable {
    let ok: Bool
    let skillKey: String
    let config: [String: AnyCodable]?
}

struct SkillAuditSummary: Codable {
    let scannedFiles: Int
    let critical: Int
    let warn: Int
    let info: Int
    let findingsPreview: [SkillAuditPreviewFinding]
}

struct SkillAuditPreviewFinding: Codable, Identifiable {
    let ruleId: String
    let severity: String
    let file: String
    let line: Int
    let message: String

    var id: String {
        "\(self.ruleId):\(self.file):\(self.line)"
    }
}

struct SkillAuditSnapshot: Codable {
    let quarantined: Bool
    let auditStatus: String
    let auditSummary: SkillAuditSummary?
    let lastScannedAt: Int?
    let trustReason: String
}

struct SkillTrustResult: Codable {
    let ok: Bool
    let skillKey: String
    let action: String
    let quarantined: Bool
    let auditStatus: String
    let auditSummary: SkillAuditSummary?
    let lastScannedAt: Int?
    let trustReason: String
}
