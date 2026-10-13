-- Database-level integrity guards (defence in depth behind the service layer).
-- PRD NFR-005: audit events immutable. PRD PAY-008 / AC-09: approved payroll snapshots immutable.
-- Append-only history tables cannot be modified or deleted.

CREATE TRIGGER audit_events_no_update BEFORE UPDATE ON audit_events FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'audit_events is append-only';
END;

CREATE TRIGGER audit_events_no_delete BEFORE DELETE ON audit_events FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'audit_events is append-only';
END;

CREATE TRIGGER subscription_events_no_update BEFORE UPDATE ON subscription_events FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'subscription_events is append-only';
END;

CREATE TRIGGER subscription_events_no_delete BEFORE DELETE ON subscription_events FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'subscription_events is append-only';
END;

CREATE TRIGGER manual_payment_events_no_update BEFORE UPDATE ON manual_payment_events FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'manual_payment_events is append-only';
END;

CREATE TRIGGER manual_payment_events_no_delete BEFORE DELETE ON manual_payment_events FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'manual_payment_events is append-only';
END;

CREATE TRIGGER leave_ledger_no_update BEFORE UPDATE ON leave_ledger FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'leave_ledger is append-only; post a reversal entry instead';
END;

CREATE TRIGGER leave_ledger_no_delete BEFORE DELETE ON leave_ledger FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'leave_ledger is append-only; post a reversal entry instead';
END;

CREATE TRIGGER payroll_runs_guard_update BEFORE UPDATE ON payroll_runs FOR EACH ROW
BEGIN
  IF OLD.status = 'LOCKED' THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'PAYROLL_LOCKED: locked payroll runs are immutable';
  END IF;
  IF OLD.status = 'APPROVED' AND (
       NEW.status <> 'LOCKED'
       OR NOT (NEW.gross_total <=> OLD.gross_total)
       OR NOT (NEW.deduction_total <=> OLD.deduction_total)
       OR NOT (NEW.employer_total <=> OLD.employer_total)
       OR NOT (NEW.net_total <=> OLD.net_total)
       OR NOT (NEW.employee_count <=> OLD.employee_count)
       OR NOT (NEW.snapshot_hash <=> OLD.snapshot_hash)
       OR NOT (NEW.rule_version_id <=> OLD.rule_version_id)
       OR NOT (NEW.approved_by_id <=> OLD.approved_by_id)
       OR NOT (NEW.approved_at <=> OLD.approved_at)) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'PAYROLL_LOCKED: approved payroll runs may only transition to LOCKED';
  END IF;
END;

CREATE TRIGGER payroll_runs_guard_delete BEFORE DELETE ON payroll_runs FOR EACH ROW
BEGIN
  IF OLD.status IN ('APPROVED', 'LOCKED') THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'PAYROLL_LOCKED: approved payroll runs cannot be deleted';
  END IF;
END;

CREATE TRIGGER payroll_run_employees_guard_insert BEFORE INSERT ON payroll_run_employees FOR EACH ROW
BEGIN
  IF (SELECT status FROM payroll_runs WHERE id = NEW.run_id) IN ('APPROVED', 'LOCKED') THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'PAYROLL_LOCKED: approved payroll snapshot is immutable';
  END IF;
END;

CREATE TRIGGER payroll_run_employees_guard_update BEFORE UPDATE ON payroll_run_employees FOR EACH ROW
BEGIN
  IF (SELECT status FROM payroll_runs WHERE id = OLD.run_id) IN ('APPROVED', 'LOCKED') THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'PAYROLL_LOCKED: approved payroll snapshot is immutable';
  END IF;
END;

CREATE TRIGGER payroll_run_employees_guard_delete BEFORE DELETE ON payroll_run_employees FOR EACH ROW
BEGIN
  IF (SELECT status FROM payroll_runs WHERE id = OLD.run_id) IN ('APPROVED', 'LOCKED') THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'PAYROLL_LOCKED: approved payroll snapshot is immutable';
  END IF;
END;

CREATE TRIGGER payroll_earnings_guard_update BEFORE UPDATE ON payroll_earnings FOR EACH ROW
BEGIN
  IF (SELECT r.status FROM payroll_runs r JOIN payroll_run_employees e ON e.run_id = r.id WHERE e.id = OLD.run_employee_id) IN ('APPROVED', 'LOCKED') THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'PAYROLL_LOCKED: approved payroll snapshot is immutable';
  END IF;
END;

CREATE TRIGGER payroll_earnings_guard_delete BEFORE DELETE ON payroll_earnings FOR EACH ROW
BEGIN
  IF (SELECT r.status FROM payroll_runs r JOIN payroll_run_employees e ON e.run_id = r.id WHERE e.id = OLD.run_employee_id) IN ('APPROVED', 'LOCKED') THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'PAYROLL_LOCKED: approved payroll snapshot is immutable';
  END IF;
END;

CREATE TRIGGER payroll_deductions_guard_update BEFORE UPDATE ON payroll_deductions FOR EACH ROW
BEGIN
  IF (SELECT r.status FROM payroll_runs r JOIN payroll_run_employees e ON e.run_id = r.id WHERE e.id = OLD.run_employee_id) IN ('APPROVED', 'LOCKED') THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'PAYROLL_LOCKED: approved payroll snapshot is immutable';
  END IF;
END;

CREATE TRIGGER payroll_deductions_guard_delete BEFORE DELETE ON payroll_deductions FOR EACH ROW
BEGIN
  IF (SELECT r.status FROM payroll_runs r JOIN payroll_run_employees e ON e.run_id = r.id WHERE e.id = OLD.run_employee_id) IN ('APPROVED', 'LOCKED') THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'PAYROLL_LOCKED: approved payroll snapshot is immutable';
  END IF;
END;
