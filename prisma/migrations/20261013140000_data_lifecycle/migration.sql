-- AlterTable
ALTER TABLE `bank_export_batches` ADD COLUMN `file_purged_at` DATETIME(3) NULL;

-- AlterTable
ALTER TABLE `import_batches` ADD COLUMN `file_purged_at` DATETIME(3) NULL;

-- AlterTable
ALTER TABLE `tenants` ADD COLUMN `closed_at` DATETIME(3) NULL,
    ADD COLUMN `legal_hold` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `legal_hold_reason` VARCHAR(500) NULL,
    ADD COLUMN `purge_after` DATETIME(3) NULL,
    ADD COLUMN `retention_policy` JSON NULL;

-- CreateTable
CREATE TABLE `data_exports` (
    `id` CHAR(36) NOT NULL,
    `tenant_id` CHAR(36) NOT NULL,
    `requested_by_id` CHAR(36) NOT NULL,
    `status` ENUM('QUEUED', 'READY', 'FAILED', 'EXPIRED') NOT NULL DEFAULT 'QUEUED',
    `storage_key` VARCHAR(255) NULL,
    `size_bytes` INTEGER NULL,
    `sha256` CHAR(64) NULL,
    `error` VARCHAR(500) NULL,
    `expires_at` DATETIME(3) NULL,
    `completed_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `data_exports_tenant_id_created_at_idx`(`tenant_id`, `created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `deletion_requests` (
    `id` CHAR(36) NOT NULL,
    `tenant_id` CHAR(36) NOT NULL,
    `requested_by_id` CHAR(36) NOT NULL,
    `reason` VARCHAR(1000) NOT NULL,
    `status` ENUM('PENDING', 'APPROVED', 'CANCELLED', 'REJECTED', 'EXECUTED') NOT NULL DEFAULT 'PENDING',
    `cooling_off_until` DATETIME(3) NOT NULL,
    `decided_by_id` CHAR(36) NULL,
    `decided_at` DATETIME(3) NULL,
    `decision_note` VARCHAR(1000) NULL,
    `executed_at` DATETIME(3) NULL,
    `summary` JSON NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `deletion_requests_tenant_id_status_idx`(`tenant_id`, `status`),
    INDEX `deletion_requests_status_cooling_off_until_idx`(`status`, `cooling_off_until`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `retention_runs` (
    `id` CHAR(36) NOT NULL,
    `tenant_id` CHAR(36) NULL,
    `started_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `finished_at` DATETIME(3) NULL,
    `summary` JSON NULL,

    INDEX `retention_runs_tenant_id_started_at_idx`(`tenant_id`, `started_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;



-- Retention purge (NFR-011): statutory records may be DELETED (never updated) only by the retention
-- job, which sets @yardhrms_retention_purge = 1 inside its own transaction once the legal retention
-- period has passed and no legal hold applies. All other deletes remain blocked.
DROP TRIGGER IF EXISTS audit_events_no_delete;
CREATE TRIGGER audit_events_no_delete BEFORE DELETE ON audit_events FOR EACH ROW
BEGIN
  IF (@yardhrms_retention_purge IS NULL OR @yardhrms_retention_purge <> 1) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'audit_events is append-only';
  END IF;
END;

DROP TRIGGER IF EXISTS leave_ledger_no_delete;
CREATE TRIGGER leave_ledger_no_delete BEFORE DELETE ON leave_ledger FOR EACH ROW
BEGIN
  IF (@yardhrms_retention_purge IS NULL OR @yardhrms_retention_purge <> 1) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'leave_ledger is append-only; post a reversal entry instead';
  END IF;
END;

DROP TRIGGER IF EXISTS payroll_runs_guard_delete;
CREATE TRIGGER payroll_runs_guard_delete BEFORE DELETE ON payroll_runs FOR EACH ROW
BEGIN
  IF OLD.status IN ('APPROVED', 'LOCKED') AND (@yardhrms_retention_purge IS NULL OR @yardhrms_retention_purge <> 1) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'PAYROLL_LOCKED: approved payroll runs cannot be deleted';
  END IF;
END;

DROP TRIGGER IF EXISTS payroll_run_employees_guard_delete;
CREATE TRIGGER payroll_run_employees_guard_delete BEFORE DELETE ON payroll_run_employees FOR EACH ROW
BEGIN
  IF (SELECT status FROM payroll_runs WHERE id = OLD.run_id) IN ('APPROVED', 'LOCKED') AND (@yardhrms_retention_purge IS NULL OR @yardhrms_retention_purge <> 1) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'PAYROLL_LOCKED: approved payroll snapshot is immutable';
  END IF;
END;

DROP TRIGGER IF EXISTS payroll_earnings_guard_delete;
CREATE TRIGGER payroll_earnings_guard_delete BEFORE DELETE ON payroll_earnings FOR EACH ROW
BEGIN
  IF (SELECT r.status FROM payroll_runs r JOIN payroll_run_employees e ON e.run_id = r.id WHERE e.id = OLD.run_employee_id) IN ('APPROVED', 'LOCKED') AND (@yardhrms_retention_purge IS NULL OR @yardhrms_retention_purge <> 1) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'PAYROLL_LOCKED: approved payroll snapshot is immutable';
  END IF;
END;

DROP TRIGGER IF EXISTS payroll_deductions_guard_delete;
CREATE TRIGGER payroll_deductions_guard_delete BEFORE DELETE ON payroll_deductions FOR EACH ROW
BEGIN
  IF (SELECT r.status FROM payroll_runs r JOIN payroll_run_employees e ON e.run_id = r.id WHERE e.id = OLD.run_employee_id) IN ('APPROVED', 'LOCKED') AND (@yardhrms_retention_purge IS NULL OR @yardhrms_retention_purge <> 1) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'PAYROLL_LOCKED: approved payroll snapshot is immutable';
  END IF;
END;
