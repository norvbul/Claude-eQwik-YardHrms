-- AlterTable
ALTER TABLE `statutory_components` ADD COLUMN `bracket_basis` ENUM('AFTER_THRESHOLD', 'BEFORE_THRESHOLD') NOT NULL DEFAULT 'AFTER_THRESHOLD',
    ADD COLUMN `calculation_method` ENUM('PERIOD', 'CUMULATIVE') NOT NULL DEFAULT 'PERIOD';

-- AlterTable
ALTER TABLE `tenants` ADD COLUMN `tax_year_start_month` INTEGER NOT NULL DEFAULT 1;

