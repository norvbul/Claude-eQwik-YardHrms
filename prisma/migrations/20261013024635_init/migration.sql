-- CreateTable
CREATE TABLE `tenants` (
    `id` CHAR(36) NOT NULL,
    `legal_name` VARCHAR(190) NOT NULL,
    `display_name` VARCHAR(120) NOT NULL,
    `trading_name` VARCHAR(190) NULL,
    `slug` VARCHAR(80) NOT NULL,
    `status` ENUM('ACTIVE', 'SUSPENDED', 'CLOSED') NOT NULL DEFAULT 'ACTIVE',
    `locale` VARCHAR(20) NOT NULL DEFAULT 'en-JM',
    `timezone` VARCHAR(60) NOT NULL DEFAULT 'America/Jamaica',
    `currency` CHAR(3) NOT NULL DEFAULT 'JMD',
    `trn` VARCHAR(20) NULL,
    `nis_employer_number` VARCHAR(30) NULL,
    `nht_employer_number` VARCHAR(30) NULL,
    `address_line1` VARCHAR(190) NULL,
    `address_line2` VARCHAR(190) NULL,
    `city` VARCHAR(100) NULL,
    `parish` VARCHAR(60) NULL,
    `phone` VARCHAR(40) NULL,
    `email` VARCHAR(190) NULL,
    `website` VARCHAR(190) NULL,
    `logo_key` VARCHAR(255) NULL,
    `accent_color` VARCHAR(7) NULL,
    `require_separate_approver` BOOLEAN NOT NULL DEFAULT true,
    `next_employee_seq` INTEGER NOT NULL DEFAULT 1,
    `current_subscription_id` CHAR(36) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `tenants_slug_key`(`slug`),
    UNIQUE INDEX `tenants_current_subscription_id_key`(`current_subscription_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `users` (
    `id` CHAR(36) NOT NULL,
    `email` VARCHAR(190) NOT NULL,
    `full_name` VARCHAR(120) NOT NULL,
    `password_hash` VARCHAR(255) NULL,
    `email_verified_at` DATETIME(3) NULL,
    `mfa_secret_enc` VARCHAR(512) NULL,
    `mfa_enabled_at` DATETIME(3) NULL,
    `status` ENUM('ACTIVE', 'DISABLED') NOT NULL DEFAULT 'ACTIVE',
    `platform_role` ENUM('PLATFORM_SUPER_ADMIN', 'PLATFORM_LICENSING_OFFICER') NULL,
    `failed_login_count` INTEGER NOT NULL DEFAULT 0,
    `locked_until` DATETIME(3) NULL,
    `last_login_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `users_email_key`(`email`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `sessions` (
    `id` CHAR(36) NOT NULL,
    `token_hash` CHAR(64) NOT NULL,
    `kind` ENUM('TENANT', 'PLATFORM') NOT NULL,
    `user_id` CHAR(36) NOT NULL,
    `tenant_id` CHAR(36) NULL,
    `csrf_token` CHAR(64) NOT NULL,
    `mfa_verified` BOOLEAN NOT NULL DEFAULT false,
    `ip` VARCHAR(64) NULL,
    `user_agent` VARCHAR(255) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `last_seen_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `expires_at` DATETIME(3) NOT NULL,
    `revoked_at` DATETIME(3) NULL,

    UNIQUE INDEX `sessions_token_hash_key`(`token_hash`),
    INDEX `sessions_user_id_revoked_at_idx`(`user_id`, `revoked_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `email_tokens` (
    `id` CHAR(36) NOT NULL,
    `purpose` ENUM('EMAIL_VERIFY', 'PASSWORD_RESET', 'INVITE') NOT NULL,
    `token_hash` CHAR(64) NOT NULL,
    `user_id` CHAR(36) NOT NULL,
    `tenant_id` CHAR(36) NULL,
    `expires_at` DATETIME(3) NOT NULL,
    `used_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `email_tokens_token_hash_key`(`token_hash`),
    INDEX `email_tokens_user_id_purpose_idx`(`user_id`, `purpose`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `login_events` (
    `id` CHAR(36) NOT NULL,
    `user_id` CHAR(36) NULL,
    `email` VARCHAR(190) NOT NULL,
    `kind` ENUM('TENANT', 'PLATFORM') NOT NULL,
    `success` BOOLEAN NOT NULL,
    `reason` VARCHAR(80) NULL,
    `ip` VARCHAR(64) NULL,
    `user_agent` VARCHAR(255) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `login_events_email_created_at_idx`(`email`, `created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `tenant_memberships` (
    `id` CHAR(36) NOT NULL,
    `tenant_id` CHAR(36) NOT NULL,
    `user_id` CHAR(36) NOT NULL,
    `status` ENUM('INVITED', 'ACTIVE', 'DEACTIVATED') NOT NULL DEFAULT 'ACTIVE',
    `employee_id` CHAR(36) NULL,
    `invited_by_id` CHAR(36) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `tenant_memberships_tenant_id_status_idx`(`tenant_id`, `status`),
    UNIQUE INDEX `tenant_memberships_tenant_id_user_id_key`(`tenant_id`, `user_id`),
    UNIQUE INDEX `tenant_memberships_tenant_id_employee_id_key`(`tenant_id`, `employee_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `permissions` (
    `code` VARCHAR(80) NOT NULL,
    `description` VARCHAR(255) NOT NULL,
    `scope` VARCHAR(20) NOT NULL DEFAULT 'TENANT',

    PRIMARY KEY (`code`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `roles` (
    `id` CHAR(36) NOT NULL,
    `tenant_id` CHAR(36) NOT NULL,
    `code` VARCHAR(40) NOT NULL,
    `name` VARCHAR(80) NOT NULL,
    `description` VARCHAR(255) NULL,
    `is_system` BOOLEAN NOT NULL DEFAULT false,
    `privileged` BOOLEAN NOT NULL DEFAULT false,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `roles_tenant_id_code_key`(`tenant_id`, `code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `role_permissions` (
    `role_id` CHAR(36) NOT NULL,
    `permission_code` VARCHAR(80) NOT NULL,

    PRIMARY KEY (`role_id`, `permission_code`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `membership_roles` (
    `membership_id` CHAR(36) NOT NULL,
    `role_id` CHAR(36) NOT NULL,

    PRIMARY KEY (`membership_id`, `role_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `audit_events` (
    `id` CHAR(36) NOT NULL,
    `tenant_id` CHAR(36) NULL,
    `scope` VARCHAR(20) NOT NULL DEFAULT 'TENANT',
    `actor_user_id` CHAR(36) NULL,
    `actor_email` VARCHAR(190) NULL,
    `action` VARCHAR(80) NOT NULL,
    `entity_type` VARCHAR(60) NOT NULL,
    `entity_id` VARCHAR(64) NULL,
    `subject_employee_id` CHAR(36) NULL,
    `before` JSON NULL,
    `after` JSON NULL,
    `metadata` JSON NULL,
    `reason` VARCHAR(500) NULL,
    `request_id` VARCHAR(64) NULL,
    `ip` VARCHAR(64) NULL,
    `user_agent` VARCHAR(255) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `audit_events_tenant_id_created_at_idx`(`tenant_id`, `created_at`),
    INDEX `audit_events_tenant_id_entity_type_entity_id_idx`(`tenant_id`, `entity_type`, `entity_id`),
    INDEX `audit_events_scope_created_at_idx`(`scope`, `created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `products` (
    `id` CHAR(36) NOT NULL,
    `code` VARCHAR(40) NOT NULL,
    `name` VARCHAR(120) NOT NULL,
    `description` VARCHAR(500) NULL,
    `active` BOOLEAN NOT NULL DEFAULT true,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `products_code_key`(`code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `features` (
    `code` VARCHAR(40) NOT NULL,
    `name` VARCHAR(120) NOT NULL,
    `description` VARCHAR(255) NOT NULL,

    PRIMARY KEY (`code`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `plans` (
    `id` CHAR(36) NOT NULL,
    `product_id` CHAR(36) NOT NULL,
    `code` VARCHAR(40) NOT NULL,
    `name` VARCHAR(120) NOT NULL,
    `is_free` BOOLEAN NOT NULL DEFAULT false,
    `price` DECIMAL(18, 2) NULL,
    `currency` CHAR(3) NOT NULL DEFAULT 'JMD',
    `duration_months` INTEGER NULL,
    `employee_limit` INTEGER NOT NULL,
    `user_limit` INTEGER NOT NULL,
    `grace_period_days` INTEGER NOT NULL DEFAULT 0,
    `status` ENUM('ACTIVE', 'RETIRED') NOT NULL DEFAULT 'ACTIVE',
    `version` INTEGER NOT NULL DEFAULT 1,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `plans_code_key`(`code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `plan_features` (
    `plan_id` CHAR(36) NOT NULL,
    `feature_code` VARCHAR(40) NOT NULL,
    `enabled` BOOLEAN NOT NULL DEFAULT true,

    PRIMARY KEY (`plan_id`, `feature_code`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `customers` (
    `id` CHAR(36) NOT NULL,
    `name` VARCHAR(190) NOT NULL,
    `contact_name` VARCHAR(120) NULL,
    `email` VARCHAR(190) NULL,
    `phone` VARCHAR(40) NULL,
    `address` VARCHAR(255) NULL,
    `trn` VARCHAR(20) NULL,
    `notes` TEXT NULL,
    `tenant_id` CHAR(36) NULL,
    `created_by_id` CHAR(36) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `customers_tenant_id_key`(`tenant_id`),
    INDEX `customers_name_idx`(`name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `subscriptions` (
    `id` CHAR(36) NOT NULL,
    `customer_id` CHAR(36) NOT NULL,
    `tenant_id` CHAR(36) NULL,
    `plan_id` CHAR(36) NOT NULL,
    `status` ENUM('PENDING_ACTIVATION', 'FREE', 'TRIAL', 'ACTIVE', 'GRACE', 'EXPIRED', 'SUSPENDED', 'REVOKED', 'SUPERSEDED') NOT NULL,
    `source` ENUM('FREE_SIGNUP', 'PAYMENT', 'OVERRIDE', 'MIGRATION') NOT NULL,
    `period_start` DATETIME(3) NULL,
    `period_end` DATETIME(3) NULL,
    `grace_end` DATETIME(3) NULL,
    `employee_limit_override` INTEGER NULL,
    `user_limit_override` INTEGER NULL,
    `override_reason` VARCHAR(500) NULL,
    `pending_months` INTEGER NULL,
    `created_by_id` CHAR(36) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `subscriptions_tenant_id_status_idx`(`tenant_id`, `status`),
    INDEX `subscriptions_status_period_end_idx`(`status`, `period_end`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `licenses` (
    `id` CHAR(36) NOT NULL,
    `license_key` VARCHAR(40) NOT NULL,
    `subscription_id` CHAR(36) NOT NULL,
    `tenant_id` CHAR(36) NULL,
    `status` ENUM('ACTIVE', 'INACTIVE', 'SUSPENDED', 'REVOKED') NOT NULL DEFAULT 'INACTIVE',
    `plan_code` VARCHAR(40) NOT NULL,
    `plan_name` VARCHAR(120) NOT NULL,
    `employee_limit` INTEGER NOT NULL,
    `user_limit` INTEGER NOT NULL,
    `features` JSON NOT NULL,
    `activated_at` DATETIME(3) NULL,
    `updated_at` DATETIME(3) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `licenses_license_key_key`(`license_key`),
    UNIQUE INDEX `licenses_subscription_id_key`(`subscription_id`),
    INDEX `licenses_tenant_id_idx`(`tenant_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `activation_codes` (
    `id` CHAR(36) NOT NULL,
    `code_hash` CHAR(64) NOT NULL,
    `code_hint` VARCHAR(16) NOT NULL,
    `subscription_id` CHAR(36) NOT NULL,
    `customer_id` CHAR(36) NOT NULL,
    `plan_id` CHAR(36) NOT NULL,
    `product_code` VARCHAR(40) NOT NULL,
    `status` ENUM('ISSUED', 'REDEEMED', 'EXPIRED', 'REVOKED') NOT NULL DEFAULT 'ISSUED',
    `expires_at` DATETIME(3) NOT NULL,
    `issued_by_id` CHAR(36) NOT NULL,
    `redeemed_at` DATETIME(3) NULL,
    `redeemed_tenant_id` CHAR(36) NULL,
    `redeemed_by_user_id` CHAR(36) NULL,
    `revoked_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `activation_codes_code_hash_key`(`code_hash`),
    INDEX `activation_codes_status_expires_at_idx`(`status`, `expires_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `manual_payments` (
    `id` CHAR(36) NOT NULL,
    `customer_id` CHAR(36) NOT NULL,
    `tenant_id` CHAR(36) NULL,
    `plan_id` CHAR(36) NULL,
    `invoice_number` VARCHAR(60) NULL,
    `reference` VARCHAR(120) NOT NULL,
    `payment_date` DATE NOT NULL,
    `amount` DECIMAL(18, 2) NOT NULL,
    `currency` CHAR(3) NOT NULL,
    `method` ENUM('CASH', 'BANK_TRANSFER', 'CHEQUE', 'OTHER') NOT NULL,
    `period_start` DATE NULL,
    `period_end` DATE NULL,
    `notes` TEXT NULL,
    `status` ENUM('PENDING', 'VERIFIED', 'REJECTED', 'REVERSED') NOT NULL DEFAULT 'PENDING',
    `recorded_by_id` CHAR(36) NOT NULL,
    `verified_by_id` CHAR(36) NULL,
    `verified_at` DATETIME(3) NULL,
    `subscription_id` CHAR(36) NULL,
    `consumed_at` DATETIME(3) NULL,
    `consumed_for` VARCHAR(20) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `manual_payments_status_payment_date_idx`(`status`, `payment_date`),
    UNIQUE INDEX `manual_payments_customer_id_reference_key`(`customer_id`, `reference`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `manual_payment_events` (
    `id` CHAR(36) NOT NULL,
    `payment_id` CHAR(36) NOT NULL,
    `from_status` ENUM('PENDING', 'VERIFIED', 'REJECTED', 'REVERSED') NULL,
    `to_status` ENUM('PENDING', 'VERIFIED', 'REJECTED', 'REVERSED') NOT NULL,
    `actor_id` CHAR(36) NOT NULL,
    `actor_email` VARCHAR(190) NOT NULL,
    `reason` VARCHAR(500) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `manual_payment_events_payment_id_created_at_idx`(`payment_id`, `created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `payment_evidence` (
    `id` CHAR(36) NOT NULL,
    `payment_id` CHAR(36) NOT NULL,
    `storage_key` VARCHAR(255) NOT NULL,
    `file_name` VARCHAR(190) NOT NULL,
    `content_type` VARCHAR(100) NOT NULL,
    `size_bytes` INTEGER NOT NULL,
    `sha256` CHAR(64) NOT NULL,
    `uploaded_by_id` CHAR(36) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `subscription_events` (
    `id` CHAR(36) NOT NULL,
    `subscription_id` CHAR(36) NOT NULL,
    `tenant_id` CHAR(36) NULL,
    `type` VARCHAR(40) NOT NULL,
    `from_status` VARCHAR(30) NULL,
    `to_status` VARCHAR(30) NULL,
    `payment_id` CHAR(36) NULL,
    `actor_user_id` CHAR(36) NULL,
    `reason` VARCHAR(500) NULL,
    `data` JSON NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `subscription_events_payment_id_key`(`payment_id`),
    INDEX `subscription_events_subscription_id_created_at_idx`(`subscription_id`, `created_at`),
    INDEX `subscription_events_tenant_id_idx`(`tenant_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `departments` (
    `id` CHAR(36) NOT NULL,
    `tenant_id` CHAR(36) NOT NULL,
    `code` VARCHAR(30) NOT NULL,
    `name` VARCHAR(120) NOT NULL,
    `description` VARCHAR(255) NULL,
    `cost_center` VARCHAR(40) NULL,
    `active` BOOLEAN NOT NULL DEFAULT true,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `departments_tenant_id_code_key`(`tenant_id`, `code`),
    UNIQUE INDEX `departments_tenant_id_id_key`(`tenant_id`, `id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `branches` (
    `id` CHAR(36) NOT NULL,
    `tenant_id` CHAR(36) NOT NULL,
    `code` VARCHAR(30) NOT NULL,
    `name` VARCHAR(120) NOT NULL,
    `description` VARCHAR(255) NULL,
    `parish` VARCHAR(60) NULL,
    `address` VARCHAR(255) NULL,
    `active` BOOLEAN NOT NULL DEFAULT true,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `branches_tenant_id_code_key`(`tenant_id`, `code`),
    UNIQUE INDEX `branches_tenant_id_id_key`(`tenant_id`, `id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `positions` (
    `id` CHAR(36) NOT NULL,
    `tenant_id` CHAR(36) NOT NULL,
    `code` VARCHAR(30) NOT NULL,
    `name` VARCHAR(120) NOT NULL,
    `description` VARCHAR(255) NULL,
    `department_id` CHAR(36) NULL,
    `active` BOOLEAN NOT NULL DEFAULT true,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `positions_tenant_id_code_key`(`tenant_id`, `code`),
    UNIQUE INDEX `positions_tenant_id_id_key`(`tenant_id`, `id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `employment_types` (
    `id` CHAR(36) NOT NULL,
    `tenant_id` CHAR(36) NOT NULL,
    `code` VARCHAR(30) NOT NULL,
    `name` VARCHAR(120) NOT NULL,
    `description` VARCHAR(255) NULL,
    `active` BOOLEAN NOT NULL DEFAULT true,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `employment_types_tenant_id_code_key`(`tenant_id`, `code`),
    UNIQUE INDEX `employment_types_tenant_id_id_key`(`tenant_id`, `id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `shift_types` (
    `id` CHAR(36) NOT NULL,
    `tenant_id` CHAR(36) NOT NULL,
    `code` VARCHAR(30) NOT NULL,
    `name` VARCHAR(120) NOT NULL,
    `description` VARCHAR(255) NULL,
    `default_start` VARCHAR(5) NULL,
    `default_end` VARCHAR(5) NULL,
    `active` BOOLEAN NOT NULL DEFAULT true,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `shift_types_tenant_id_code_key`(`tenant_id`, `code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `public_holidays` (
    `id` CHAR(36) NOT NULL,
    `tenant_id` CHAR(36) NOT NULL,
    `date` DATE NOT NULL,
    `name` VARCHAR(120) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `public_holidays_tenant_id_date_key`(`tenant_id`, `date`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `pay_frequencies` (
    `id` CHAR(36) NOT NULL,
    `tenant_id` CHAR(36) NOT NULL,
    `frequency` ENUM('WEEKLY', 'FORTNIGHTLY', 'MONTHLY') NOT NULL,
    `standard_hours` DECIMAL(8, 2) NOT NULL,
    `working_days` DECIMAL(6, 2) NOT NULL,
    `periods_per_year` INTEGER NOT NULL,
    `active` BOOLEAN NOT NULL DEFAULT true,
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `pay_frequencies_tenant_id_frequency_key`(`tenant_id`, `frequency`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `employees` (
    `id` CHAR(36) NOT NULL,
    `tenant_id` CHAR(36) NOT NULL,
    `employee_number` VARCHAR(30) NOT NULL,
    `first_name` VARCHAR(80) NOT NULL,
    `middle_name` VARCHAR(80) NULL,
    `last_name` VARCHAR(80) NOT NULL,
    `preferred_name` VARCHAR(80) NULL,
    `email` VARCHAR(190) NULL,
    `phone` VARCHAR(40) NULL,
    `mobile` VARCHAR(40) NULL,
    `date_of_birth` DATE NULL,
    `gender` ENUM('FEMALE', 'MALE', 'OTHER', 'UNDISCLOSED') NULL,
    `address_line1` VARCHAR(190) NULL,
    `address_line2` VARCHAR(190) NULL,
    `city` VARCHAR(100) NULL,
    `parish` VARCHAR(60) NULL,
    `trn_enc` VARCHAR(255) NULL,
    `trn_last4` VARCHAR(4) NULL,
    `nis_enc` VARCHAR(255) NULL,
    `nis_last4` VARCHAR(4) NULL,
    `nht_enc` VARCHAR(255) NULL,
    `nht_last4` VARCHAR(4) NULL,
    `department_id` CHAR(36) NULL,
    `branch_id` CHAR(36) NULL,
    `position_id` CHAR(36) NULL,
    `employment_type_id` CHAR(36) NULL,
    `supervisor_id` CHAR(36) NULL,
    `hire_date` DATE NOT NULL,
    `probation_end_date` DATE NULL,
    `confirmation_date` DATE NULL,
    `termination_date` DATE NULL,
    `termination_reason` VARCHAR(255) NULL,
    `pay_frequency` ENUM('WEEKLY', 'FORTNIGHTLY', 'MONTHLY') NOT NULL,
    `pay_type` ENUM('SALARY', 'HOURLY') NOT NULL,
    `salary_per_period` DECIMAL(18, 2) NULL,
    `hourly_rate` DECIMAL(18, 4) NULL,
    `standard_hours_override` DECIMAL(8, 2) NULL,
    `overtime_eligible` BOOLEAN NOT NULL DEFAULT false,
    `statutory_exemptions` JSON NULL,
    `status` ENUM('ACTIVE', 'INACTIVE', 'TERMINATED') NOT NULL DEFAULT 'ACTIVE',
    `source` ENUM('MANUAL', 'IMPORT', 'MIGRATION') NOT NULL DEFAULT 'MANUAL',
    `version` INTEGER NOT NULL DEFAULT 0,
    `created_by_id` CHAR(36) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    `deleted_at` DATETIME(3) NULL,

    INDEX `employees_tenant_id_status_idx`(`tenant_id`, `status`),
    INDEX `employees_tenant_id_last_name_first_name_idx`(`tenant_id`, `last_name`, `first_name`),
    INDEX `employees_tenant_id_department_id_idx`(`tenant_id`, `department_id`),
    UNIQUE INDEX `employees_tenant_id_employee_number_key`(`tenant_id`, `employee_number`),
    UNIQUE INDEX `employees_tenant_id_id_key`(`tenant_id`, `id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `employee_emergency_contacts` (
    `id` CHAR(36) NOT NULL,
    `tenant_id` CHAR(36) NOT NULL,
    `employee_id` CHAR(36) NOT NULL,
    `name` VARCHAR(120) NOT NULL,
    `relationship` VARCHAR(60) NOT NULL,
    `phone` VARCHAR(40) NOT NULL,
    `email` VARCHAR(190) NULL,
    `address` VARCHAR(255) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `employee_emergency_contacts_tenant_id_employee_id_idx`(`tenant_id`, `employee_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `employee_bank_accounts` (
    `id` CHAR(36) NOT NULL,
    `tenant_id` CHAR(36) NOT NULL,
    `employee_id` CHAR(36) NOT NULL,
    `bank_name` VARCHAR(120) NOT NULL,
    `branch_name` VARCHAR(120) NULL,
    `branch_code` VARCHAR(20) NULL,
    `account_type` ENUM('SAVINGS', 'CHEQUING', 'OTHER') NOT NULL DEFAULT 'SAVINGS',
    `account_number_enc` VARCHAR(255) NOT NULL,
    `account_last4` VARCHAR(4) NOT NULL,
    `account_holder` VARCHAR(120) NOT NULL,
    `is_primary` BOOLEAN NOT NULL DEFAULT true,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    `deleted_at` DATETIME(3) NULL,

    INDEX `employee_bank_accounts_tenant_id_employee_id_idx`(`tenant_id`, `employee_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `employee_documents` (
    `id` CHAR(36) NOT NULL,
    `tenant_id` CHAR(36) NOT NULL,
    `employee_id` CHAR(36) NOT NULL,
    `category` VARCHAR(60) NOT NULL,
    `file_name` VARCHAR(190) NOT NULL,
    `content_type` VARCHAR(100) NOT NULL,
    `size_bytes` INTEGER NOT NULL,
    `sha256` CHAR(64) NOT NULL,
    `storage_key` VARCHAR(255) NOT NULL,
    `uploaded_by_id` CHAR(36) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `deleted_at` DATETIME(3) NULL,

    INDEX `employee_documents_tenant_id_employee_id_idx`(`tenant_id`, `employee_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `compensation_histories` (
    `id` CHAR(36) NOT NULL,
    `tenant_id` CHAR(36) NOT NULL,
    `employee_id` CHAR(36) NOT NULL,
    `effective_date` DATE NOT NULL,
    `pay_frequency` ENUM('WEEKLY', 'FORTNIGHTLY', 'MONTHLY') NOT NULL,
    `pay_type` ENUM('SALARY', 'HOURLY') NOT NULL,
    `salary_per_period` DECIMAL(18, 2) NULL,
    `hourly_rate` DECIMAL(18, 4) NULL,
    `standard_hours_override` DECIMAL(8, 2) NULL,
    `overtime_eligible` BOOLEAN NOT NULL,
    `reason` VARCHAR(255) NOT NULL,
    `changed_by_id` CHAR(36) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `compensation_histories_tenant_id_employee_id_effective_date_idx`(`tenant_id`, `employee_id`, `effective_date`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `employment_histories` (
    `id` CHAR(36) NOT NULL,
    `tenant_id` CHAR(36) NOT NULL,
    `employee_id` CHAR(36) NOT NULL,
    `event_type` VARCHAR(40) NOT NULL,
    `event_date` DATE NOT NULL,
    `details` JSON NULL,
    `reason` VARCHAR(255) NULL,
    `actor_user_id` CHAR(36) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `employment_histories_tenant_id_employee_id_event_date_idx`(`tenant_id`, `employee_id`, `event_date`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `allowance_types` (
    `id` CHAR(36) NOT NULL,
    `tenant_id` CHAR(36) NOT NULL,
    `code` VARCHAR(20) NOT NULL,
    `name` VARCHAR(80) NOT NULL,
    `taxable` BOOLEAN NOT NULL,
    `active` BOOLEAN NOT NULL DEFAULT true,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `allowance_types_tenant_id_code_key`(`tenant_id`, `code`),
    UNIQUE INDEX `allowance_types_tenant_id_id_key`(`tenant_id`, `id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `employee_allowances` (
    `id` CHAR(36) NOT NULL,
    `tenant_id` CHAR(36) NOT NULL,
    `employee_id` CHAR(36) NOT NULL,
    `allowance_type_id` CHAR(36) NOT NULL,
    `amount` DECIMAL(18, 2) NOT NULL,
    `start_date` DATE NOT NULL,
    `end_date` DATE NULL,
    `created_by_id` CHAR(36) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `deleted_at` DATETIME(3) NULL,

    INDEX `employee_allowances_tenant_id_employee_id_idx`(`tenant_id`, `employee_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `deduction_types` (
    `id` CHAR(36) NOT NULL,
    `tenant_id` CHAR(36) NOT NULL,
    `code` VARCHAR(20) NOT NULL,
    `name` VARCHAR(80) NOT NULL,
    `category` ENUM('PENSION', 'INSURANCE', 'LOAN', 'ADVANCE', 'UNION', 'GARNISHMENT', 'OTHER') NOT NULL,
    `pre_tax` BOOLEAN NOT NULL DEFAULT false,
    `active` BOOLEAN NOT NULL DEFAULT true,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `deduction_types_tenant_id_code_key`(`tenant_id`, `code`),
    UNIQUE INDEX `deduction_types_tenant_id_id_key`(`tenant_id`, `id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `employee_deductions` (
    `id` CHAR(36) NOT NULL,
    `tenant_id` CHAR(36) NOT NULL,
    `employee_id` CHAR(36) NOT NULL,
    `deduction_type_id` CHAR(36) NOT NULL,
    `amount` DECIMAL(18, 2) NOT NULL,
    `start_date` DATE NOT NULL,
    `end_date` DATE NULL,
    `reference` VARCHAR(80) NULL,
    `balance` DECIMAL(18, 2) NULL,
    `created_by_id` CHAR(36) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `deleted_at` DATETIME(3) NULL,

    INDEX `employee_deductions_tenant_id_employee_id_idx`(`tenant_id`, `employee_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `overtime_rules` (
    `id` CHAR(36) NOT NULL,
    `tenant_id` CHAR(36) NOT NULL,
    `code` VARCHAR(20) NOT NULL,
    `name` VARCHAR(80) NOT NULL,
    `multiplier` DECIMAL(6, 3) NOT NULL,
    `description` VARCHAR(255) NULL,
    `active` BOOLEAN NOT NULL DEFAULT true,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `overtime_rules_tenant_id_code_key`(`tenant_id`, `code`),
    UNIQUE INDEX `overtime_rules_tenant_id_id_key`(`tenant_id`, `id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `leave_types` (
    `id` CHAR(36) NOT NULL,
    `tenant_id` CHAR(36) NOT NULL,
    `code` VARCHAR(20) NOT NULL,
    `name` VARCHAR(80) NOT NULL,
    `category` ENUM('ANNUAL', 'SICK', 'MATERNITY', 'COMPASSIONATE', 'UNPAID', 'STUDY', 'SPECIAL', 'OTHER') NOT NULL,
    `pay_percent` DECIMAL(5, 2) NOT NULL DEFAULT 100,
    `requires_document` BOOLEAN NOT NULL DEFAULT false,
    `active` BOOLEAN NOT NULL DEFAULT true,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `leave_types_tenant_id_code_key`(`tenant_id`, `code`),
    UNIQUE INDEX `leave_types_tenant_id_id_key`(`tenant_id`, `id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `leave_policies` (
    `id` CHAR(36) NOT NULL,
    `tenant_id` CHAR(36) NOT NULL,
    `leave_type_id` CHAR(36) NOT NULL,
    `employment_type_id` CHAR(36) NULL,
    `annual_entitlement_days` DECIMAL(6, 2) NOT NULL,
    `accrual_method` ENUM('ANNUAL_GRANT', 'MONTHLY_ACCRUAL', 'NONE') NOT NULL,
    `carry_forward_max_days` DECIMAL(6, 2) NOT NULL,
    `carry_forward_expiry_months` INTEGER NOT NULL DEFAULT 0,
    `min_service_months` INTEGER NOT NULL DEFAULT 0,
    `effective_from` DATE NOT NULL,
    `notes` VARCHAR(255) NULL,
    `created_by_id` CHAR(36) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `leave_policies_tenant_id_leave_type_id_effective_from_idx`(`tenant_id`, `leave_type_id`, `effective_from`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `leave_requests` (
    `id` CHAR(36) NOT NULL,
    `tenant_id` CHAR(36) NOT NULL,
    `employee_id` CHAR(36) NOT NULL,
    `leave_type_id` CHAR(36) NOT NULL,
    `start_date` DATE NOT NULL,
    `end_date` DATE NOT NULL,
    `half_day_start` BOOLEAN NOT NULL DEFAULT false,
    `half_day_end` BOOLEAN NOT NULL DEFAULT false,
    `working_days` DECIMAL(6, 2) NOT NULL,
    `pay_percent` DECIMAL(5, 2) NOT NULL,
    `reason` VARCHAR(500) NULL,
    `status` ENUM('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED') NOT NULL DEFAULT 'PENDING',
    `submitted_by_user_id` CHAR(36) NOT NULL,
    `delegated` BOOLEAN NOT NULL DEFAULT false,
    `decided_by_user_id` CHAR(36) NULL,
    `decided_at` DATETIME(3) NULL,
    `decision_comment` VARCHAR(500) NULL,
    `document_key` VARCHAR(255) NULL,
    `payroll_run_id` CHAR(36) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `leave_requests_tenant_id_status_idx`(`tenant_id`, `status`),
    INDEX `leave_requests_tenant_id_employee_id_start_date_idx`(`tenant_id`, `employee_id`, `start_date`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `leave_approvals` (
    `id` CHAR(36) NOT NULL,
    `tenant_id` CHAR(36) NOT NULL,
    `leave_request_id` CHAR(36) NOT NULL,
    `action` VARCHAR(20) NOT NULL,
    `actor_user_id` CHAR(36) NOT NULL,
    `comment` VARCHAR(500) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `leave_approvals_tenant_id_leave_request_id_idx`(`tenant_id`, `leave_request_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `leave_ledger` (
    `id` CHAR(36) NOT NULL,
    `tenant_id` CHAR(36) NOT NULL,
    `employee_id` CHAR(36) NOT NULL,
    `leave_type_id` CHAR(36) NOT NULL,
    `entry_type` ENUM('OPENING', 'ACCRUAL', 'USAGE', 'ADJUSTMENT', 'CARRY_FORWARD', 'EXPIRY', 'REVERSAL') NOT NULL,
    `days` DECIMAL(6, 2) NOT NULL,
    `effective_date` DATE NOT NULL,
    `leave_request_id` CHAR(36) NULL,
    `reason` VARCHAR(255) NULL,
    `posting_key` VARCHAR(80) NULL,
    `created_by_id` CHAR(36) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `leave_ledger_tenant_id_employee_id_leave_type_id_idx`(`tenant_id`, `employee_id`, `leave_type_id`),
    UNIQUE INDEX `leave_ledger_tenant_id_employee_id_leave_type_id_posting_key_key`(`tenant_id`, `employee_id`, `leave_type_id`, `posting_key`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `timesheets` (
    `id` CHAR(36) NOT NULL,
    `tenant_id` CHAR(36) NOT NULL,
    `employee_id` CHAR(36) NOT NULL,
    `work_date` DATE NOT NULL,
    `shift_type_id` CHAR(36) NULL,
    `start_time` VARCHAR(5) NOT NULL,
    `end_time` VARCHAR(5) NOT NULL,
    `overnight` BOOLEAN NOT NULL DEFAULT false,
    `break_hours` DECIMAL(5, 2) NOT NULL DEFAULT 0,
    `regular_hours` DECIMAL(6, 2) NOT NULL,
    `status` ENUM('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED') NOT NULL DEFAULT 'PENDING',
    `active_key` VARCHAR(100) NULL,
    `submitted_by_user_id` CHAR(36) NOT NULL,
    `delegated` BOOLEAN NOT NULL DEFAULT false,
    `approved_by_user_id` CHAR(36) NULL,
    `approved_at` DATETIME(3) NULL,
    `comments` VARCHAR(500) NULL,
    `decision_comment` VARCHAR(500) NULL,
    `source` ENUM('MANUAL', 'IMPORT', 'MIGRATION') NOT NULL DEFAULT 'MANUAL',
    `import_batch_id` CHAR(36) NULL,
    `payroll_run_id` CHAR(36) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `timesheets_active_key_key`(`active_key`),
    INDEX `timesheets_tenant_id_employee_id_work_date_idx`(`tenant_id`, `employee_id`, `work_date`),
    INDEX `timesheets_tenant_id_status_work_date_idx`(`tenant_id`, `status`, `work_date`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `timesheet_approvals` (
    `id` CHAR(36) NOT NULL,
    `tenant_id` CHAR(36) NOT NULL,
    `timesheet_id` CHAR(36) NOT NULL,
    `action` VARCHAR(20) NOT NULL,
    `actor_user_id` CHAR(36) NOT NULL,
    `comment` VARCHAR(500) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `timesheet_approvals_tenant_id_timesheet_id_idx`(`tenant_id`, `timesheet_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `overtime_requests` (
    `id` CHAR(36) NOT NULL,
    `tenant_id` CHAR(36) NOT NULL,
    `employee_id` CHAR(36) NOT NULL,
    `work_date` DATE NOT NULL,
    `hours` DECIMAL(5, 2) NOT NULL,
    `overtime_rule_id` CHAR(36) NOT NULL,
    `multiplier` DECIMAL(6, 3) NOT NULL,
    `reason` VARCHAR(500) NOT NULL,
    `status` ENUM('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED') NOT NULL DEFAULT 'PENDING',
    `submitted_by_user_id` CHAR(36) NOT NULL,
    `delegated` BOOLEAN NOT NULL DEFAULT false,
    `decided_by_user_id` CHAR(36) NULL,
    `decided_at` DATETIME(3) NULL,
    `decision_comment` VARCHAR(500) NULL,
    `payroll_run_id` CHAR(36) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `overtime_requests_tenant_id_status_work_date_idx`(`tenant_id`, `status`, `work_date`),
    INDEX `overtime_requests_tenant_id_employee_id_work_date_idx`(`tenant_id`, `employee_id`, `work_date`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `overtime_approvals` (
    `id` CHAR(36) NOT NULL,
    `tenant_id` CHAR(36) NOT NULL,
    `overtime_id` CHAR(36) NOT NULL,
    `action` VARCHAR(20) NOT NULL,
    `actor_user_id` CHAR(36) NOT NULL,
    `comment` VARCHAR(500) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `overtime_approvals_tenant_id_overtime_id_idx`(`tenant_id`, `overtime_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `statutory_rule_versions` (
    `id` CHAR(36) NOT NULL,
    `tenant_id` CHAR(36) NOT NULL,
    `name` VARCHAR(120) NOT NULL,
    `effective_from` DATE NOT NULL,
    `effective_to` DATE NULL,
    `status` ENUM('DRAFT', 'APPROVED', 'RETIRED') NOT NULL DEFAULT 'DRAFT',
    `source_reference` VARCHAR(500) NULL,
    `attestation` VARCHAR(1000) NULL,
    `created_by_id` CHAR(36) NULL,
    `approved_by_id` CHAR(36) NULL,
    `approved_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `statutory_rule_versions_tenant_id_status_effective_from_idx`(`tenant_id`, `status`, `effective_from`),
    UNIQUE INDEX `statutory_rule_versions_tenant_id_id_key`(`tenant_id`, `id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `statutory_components` (
    `id` CHAR(36) NOT NULL,
    `tenant_id` CHAR(36) NOT NULL,
    `version_id` CHAR(36) NOT NULL,
    `code` VARCHAR(20) NOT NULL,
    `name` VARCHAR(80) NOT NULL,
    `sort_order` INTEGER NOT NULL,
    `base` ENUM('GROSS', 'TAXABLE_GROSS', 'STATUTORY_INCOME') NOT NULL,
    `employee_rate` DECIMAL(9, 6) NOT NULL,
    `employer_rate` DECIMAL(9, 6) NOT NULL,
    `annual_ceiling` DECIMAL(18, 2) NULL,
    `annual_threshold` DECIMAL(18, 2) NULL,
    `reduces_statutory_income` BOOLEAN NOT NULL DEFAULT false,
    `min_age` INTEGER NULL,
    `max_age` INTEGER NULL,
    `notes` VARCHAR(500) NULL,

    UNIQUE INDEX `statutory_components_version_id_code_key`(`version_id`, `code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `tax_thresholds` (
    `id` CHAR(36) NOT NULL,
    `component_id` CHAR(36) NOT NULL,
    `sequence` INTEGER NOT NULL,
    `up_to_annual` DECIMAL(18, 2) NULL,
    `rate` DECIMAL(9, 6) NOT NULL,

    UNIQUE INDEX `tax_thresholds_component_id_sequence_key`(`component_id`, `sequence`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `payroll_periods` (
    `id` CHAR(36) NOT NULL,
    `tenant_id` CHAR(36) NOT NULL,
    `frequency` ENUM('WEEKLY', 'FORTNIGHTLY', 'MONTHLY') NOT NULL,
    `period_start` DATE NOT NULL,
    `period_end` DATE NOT NULL,
    `pay_date` DATE NOT NULL,
    `status` ENUM('OPEN', 'CLOSED') NOT NULL DEFAULT 'OPEN',
    `closed_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `payroll_periods_tenant_id_status_period_end_idx`(`tenant_id`, `status`, `period_end`),
    UNIQUE INDEX `payroll_periods_tenant_id_frequency_period_start_key`(`tenant_id`, `frequency`, `period_start`),
    UNIQUE INDEX `payroll_periods_tenant_id_id_key`(`tenant_id`, `id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `payroll_runs` (
    `id` CHAR(36) NOT NULL,
    `tenant_id` CHAR(36) NOT NULL,
    `period_id` CHAR(36) NOT NULL,
    `run_number` VARCHAR(40) NOT NULL,
    `frequency` ENUM('WEEKLY', 'FORTNIGHTLY', 'MONTHLY') NOT NULL,
    `run_type` ENUM('REGULAR', 'SUPPLEMENTAL', 'REVERSAL') NOT NULL,
    `revision` INTEGER NOT NULL DEFAULT 1,
    `status` ENUM('DRAFT', 'PREPARED', 'REVIEWED', 'APPROVED', 'LOCKED') NOT NULL DEFAULT 'DRAFT',
    `department_id` CHAR(36) NULL,
    `employee_filter` JSON NULL,
    `rule_version_id` CHAR(36) NULL,
    `rule_version_approved` BOOLEAN NOT NULL DEFAULT false,
    `gross_total` DECIMAL(18, 2) NOT NULL DEFAULT 0,
    `deduction_total` DECIMAL(18, 2) NOT NULL DEFAULT 0,
    `employer_total` DECIMAL(18, 2) NOT NULL DEFAULT 0,
    `net_total` DECIMAL(18, 2) NOT NULL DEFAULT 0,
    `employee_count` INTEGER NOT NULL DEFAULT 0,
    `snapshot_hash` CHAR(64) NULL,
    `reversal_of_run_id` CHAR(36) NULL,
    `notes` VARCHAR(500) NULL,
    `created_by_id` CHAR(36) NOT NULL,
    `prepared_by_id` CHAR(36) NULL,
    `prepared_at` DATETIME(3) NULL,
    `reviewed_by_id` CHAR(36) NULL,
    `reviewed_at` DATETIME(3) NULL,
    `approved_by_id` CHAR(36) NULL,
    `approved_at` DATETIME(3) NULL,
    `locked_by_id` CHAR(36) NULL,
    `locked_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `payroll_runs_reversal_of_run_id_key`(`reversal_of_run_id`),
    INDEX `payroll_runs_tenant_id_status_idx`(`tenant_id`, `status`),
    UNIQUE INDEX `payroll_runs_tenant_id_run_number_key`(`tenant_id`, `run_number`),
    UNIQUE INDEX `payroll_runs_tenant_id_period_id_run_type_revision_key`(`tenant_id`, `period_id`, `run_type`, `revision`),
    UNIQUE INDEX `payroll_runs_tenant_id_id_key`(`tenant_id`, `id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `payroll_adjustments` (
    `id` CHAR(36) NOT NULL,
    `tenant_id` CHAR(36) NOT NULL,
    `run_id` CHAR(36) NOT NULL,
    `employee_id` CHAR(36) NOT NULL,
    `kind` ENUM('BONUS', 'COMMISSION', 'RETRO', 'ALLOWANCE', 'OTHER_EARNING', 'DEDUCTION') NOT NULL,
    `description` VARCHAR(120) NOT NULL,
    `amount` DECIMAL(18, 2) NOT NULL,
    `taxable` BOOLEAN NOT NULL DEFAULT true,
    `pre_tax` BOOLEAN NOT NULL DEFAULT false,
    `created_by_id` CHAR(36) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `payroll_adjustments_tenant_id_run_id_employee_id_idx`(`tenant_id`, `run_id`, `employee_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `payroll_run_employees` (
    `id` CHAR(36) NOT NULL,
    `tenant_id` CHAR(36) NOT NULL,
    `run_id` CHAR(36) NOT NULL,
    `employee_id` CHAR(36) NOT NULL,
    `employee_number` VARCHAR(30) NOT NULL,
    `employee_name` VARCHAR(200) NOT NULL,
    `department_name` VARCHAR(120) NULL,
    `position_name` VARCHAR(120) NULL,
    `pay_frequency` ENUM('WEEKLY', 'FORTNIGHTLY', 'MONTHLY') NOT NULL,
    `pay_type` ENUM('SALARY', 'HOURLY') NOT NULL,
    `trn_masked` VARCHAR(20) NULL,
    `nis_masked` VARCHAR(20) NULL,
    `bank_name` VARCHAR(120) NULL,
    `bank_account_last4` VARCHAR(4) NULL,
    `regular_hours` DECIMAL(8, 2) NOT NULL DEFAULT 0,
    `overtime_hours` DECIMAL(8, 2) NOT NULL DEFAULT 0,
    `hourly_equivalent` DECIMAL(18, 4) NOT NULL DEFAULT 0,
    `gross_pay` DECIMAL(18, 2) NOT NULL,
    `taxable_gross` DECIMAL(18, 2) NOT NULL,
    `total_deductions` DECIMAL(18, 2) NOT NULL,
    `employer_contributions` DECIMAL(18, 2) NOT NULL,
    `net_pay` DECIMAL(18, 2) NOT NULL,
    `calculation` JSON NOT NULL,
    `inputs` JSON NOT NULL,
    `warnings` JSON NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `payroll_run_employees_tenant_id_employee_id_idx`(`tenant_id`, `employee_id`),
    UNIQUE INDEX `payroll_run_employees_run_id_employee_id_key`(`run_id`, `employee_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `payroll_earnings` (
    `id` CHAR(36) NOT NULL,
    `tenant_id` CHAR(36) NOT NULL,
    `run_employee_id` CHAR(36) NOT NULL,
    `code` VARCHAR(30) NOT NULL,
    `category` VARCHAR(20) NOT NULL,
    `description` VARCHAR(160) NOT NULL,
    `quantity` DECIMAL(10, 2) NULL,
    `rate` DECIMAL(18, 4) NULL,
    `amount` DECIMAL(18, 2) NOT NULL,
    `taxable` BOOLEAN NOT NULL,

    INDEX `payroll_earnings_tenant_id_code_idx`(`tenant_id`, `code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `payroll_deductions` (
    `id` CHAR(36) NOT NULL,
    `tenant_id` CHAR(36) NOT NULL,
    `run_employee_id` CHAR(36) NOT NULL,
    `code` VARCHAR(30) NOT NULL,
    `description` VARCHAR(160) NOT NULL,
    `category` VARCHAR(20) NOT NULL,
    `statutory` BOOLEAN NOT NULL,
    `base` DECIMAL(18, 2) NULL,
    `employee_amount` DECIMAL(18, 2) NOT NULL,
    `employer_amount` DECIMAL(18, 2) NOT NULL DEFAULT 0,

    INDEX `payroll_deductions_tenant_id_code_idx`(`tenant_id`, `code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `payslips` (
    `id` CHAR(36) NOT NULL,
    `tenant_id` CHAR(36) NOT NULL,
    `run_id` CHAR(36) NOT NULL,
    `run_employee_id` CHAR(36) NOT NULL,
    `employee_id` CHAR(36) NOT NULL,
    `pay_date` DATE NOT NULL,
    `storage_key` VARCHAR(255) NULL,
    `sha256` CHAR(64) NULL,
    `generated_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `payslips_run_employee_id_key`(`run_employee_id`),
    INDEX `payslips_tenant_id_employee_id_pay_date_idx`(`tenant_id`, `employee_id`, `pay_date`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `payslip_access_events` (
    `id` CHAR(36) NOT NULL,
    `tenant_id` CHAR(36) NOT NULL,
    `payslip_id` CHAR(36) NOT NULL,
    `employee_id` CHAR(36) NOT NULL,
    `user_id` CHAR(36) NOT NULL,
    `action` VARCHAR(20) NOT NULL,
    `ip` VARCHAR(64) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `payslip_access_events_tenant_id_payslip_id_idx`(`tenant_id`, `payslip_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `bank_export_batches` (
    `id` CHAR(36) NOT NULL,
    `tenant_id` CHAR(36) NOT NULL,
    `run_id` CHAR(36) NOT NULL,
    `format` VARCHAR(10) NOT NULL,
    `row_count` INTEGER NOT NULL,
    `total_amount` DECIMAL(18, 2) NOT NULL,
    `storage_key` VARCHAR(255) NOT NULL,
    `sha256` CHAR(64) NOT NULL,
    `created_by_id` CHAR(36) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `bank_export_batches_tenant_id_run_id_idx`(`tenant_id`, `run_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `report_exports` (
    `id` CHAR(36) NOT NULL,
    `tenant_id` CHAR(36) NOT NULL,
    `report_type` VARCHAR(60) NOT NULL,
    `format` VARCHAR(10) NOT NULL,
    `parameters` JSON NULL,
    `row_count` INTEGER NOT NULL,
    `created_by_id` CHAR(36) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `report_exports_tenant_id_created_at_idx`(`tenant_id`, `created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `import_batches` (
    `id` CHAR(36) NOT NULL,
    `tenant_id` CHAR(36) NOT NULL,
    `type` ENUM('EMPLOYEES', 'TIMESHEETS') NOT NULL,
    `status` ENUM('UPLOADED', 'VALIDATED', 'QUEUED', 'PROCESSING', 'COMPLETED', 'FAILED') NOT NULL DEFAULT 'UPLOADED',
    `file_name` VARCHAR(190) NOT NULL,
    `storage_key` VARCHAR(255) NOT NULL,
    `sha256` CHAR(64) NOT NULL,
    `template_version` VARCHAR(10) NULL,
    `headers` JSON NULL,
    `mapping` JSON NULL,
    `total_rows` INTEGER NOT NULL DEFAULT 0,
    `valid_rows` INTEGER NOT NULL DEFAULT 0,
    `created_count` INTEGER NOT NULL DEFAULT 0,
    `updated_count` INTEGER NOT NULL DEFAULT 0,
    `rejected_count` INTEGER NOT NULL DEFAULT 0,
    `skipped_count` INTEGER NOT NULL DEFAULT 0,
    `error` VARCHAR(1000) NULL,
    `created_by_id` CHAR(36) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    `completed_at` DATETIME(3) NULL,

    INDEX `import_batches_tenant_id_created_at_idx`(`tenant_id`, `created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `import_rows` (
    `id` CHAR(36) NOT NULL,
    `tenant_id` CHAR(36) NOT NULL,
    `batch_id` CHAR(36) NOT NULL,
    `row_number` INTEGER NOT NULL,
    `data` JSON NOT NULL,
    `outcome` ENUM('PENDING', 'VALID', 'CREATED', 'UPDATED', 'REJECTED', 'SKIPPED') NOT NULL DEFAULT 'PENDING',
    `errors` JSON NULL,
    `entity_id` CHAR(36) NULL,
    `processed_at` DATETIME(3) NULL,

    INDEX `import_rows_batch_id_outcome_idx`(`batch_id`, `outcome`),
    UNIQUE INDEX `import_rows_batch_id_row_number_key`(`batch_id`, `row_number`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `background_jobs` (
    `id` CHAR(36) NOT NULL,
    `tenant_id` CHAR(36) NULL,
    `type` VARCHAR(60) NOT NULL,
    `payload` JSON NOT NULL,
    `status` ENUM('QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED') NOT NULL DEFAULT 'QUEUED',
    `attempts` INTEGER NOT NULL DEFAULT 0,
    `max_attempts` INTEGER NOT NULL DEFAULT 3,
    `run_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `locked_at` DATETIME(3) NULL,
    `locked_by` VARCHAR(80) NULL,
    `last_error` TEXT NULL,
    `result` JSON NULL,
    `dedupe_key` VARCHAR(120) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `background_jobs_dedupe_key_key`(`dedupe_key`),
    INDEX `background_jobs_status_run_at_idx`(`status`, `run_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `outbound_emails` (
    `id` CHAR(36) NOT NULL,
    `to_address` VARCHAR(190) NOT NULL,
    `subject` VARCHAR(255) NOT NULL,
    `template` VARCHAR(60) NOT NULL,
    `status` VARCHAR(20) NOT NULL,
    `error` VARCHAR(500) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `outbound_emails_to_address_created_at_idx`(`to_address`, `created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `system_errors` (
    `id` CHAR(36) NOT NULL,
    `request_id` VARCHAR(64) NULL,
    `path` VARCHAR(255) NULL,
    `message` TEXT NOT NULL,
    `stack` TEXT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `legacy_id_map` (
    `id` CHAR(36) NOT NULL,
    `tenant_id` CHAR(36) NOT NULL,
    `entity_type` VARCHAR(40) NOT NULL,
    `legacy_id` VARCHAR(120) NOT NULL,
    `new_id` CHAR(36) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `legacy_id_map_tenant_id_entity_type_legacy_id_key`(`tenant_id`, `entity_type`, `legacy_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `tenants` ADD CONSTRAINT `tenants_current_subscription_id_fkey` FOREIGN KEY (`current_subscription_id`) REFERENCES `subscriptions`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `sessions` ADD CONSTRAINT `sessions_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `email_tokens` ADD CONSTRAINT `email_tokens_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `tenant_memberships` ADD CONSTRAINT `tenant_memberships_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `tenant_memberships` ADD CONSTRAINT `tenant_memberships_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `tenant_memberships` ADD CONSTRAINT `tenant_memberships_employee_id_fkey` FOREIGN KEY (`employee_id`) REFERENCES `employees`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `roles` ADD CONSTRAINT `roles_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `role_permissions` ADD CONSTRAINT `role_permissions_role_id_fkey` FOREIGN KEY (`role_id`) REFERENCES `roles`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `role_permissions` ADD CONSTRAINT `role_permissions_permission_code_fkey` FOREIGN KEY (`permission_code`) REFERENCES `permissions`(`code`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `membership_roles` ADD CONSTRAINT `membership_roles_membership_id_fkey` FOREIGN KEY (`membership_id`) REFERENCES `tenant_memberships`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `membership_roles` ADD CONSTRAINT `membership_roles_role_id_fkey` FOREIGN KEY (`role_id`) REFERENCES `roles`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `audit_events` ADD CONSTRAINT `audit_events_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `plans` ADD CONSTRAINT `plans_product_id_fkey` FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `plan_features` ADD CONSTRAINT `plan_features_plan_id_fkey` FOREIGN KEY (`plan_id`) REFERENCES `plans`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `plan_features` ADD CONSTRAINT `plan_features_feature_code_fkey` FOREIGN KEY (`feature_code`) REFERENCES `features`(`code`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `customers` ADD CONSTRAINT `customers_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `subscriptions` ADD CONSTRAINT `subscriptions_customer_id_fkey` FOREIGN KEY (`customer_id`) REFERENCES `customers`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `subscriptions` ADD CONSTRAINT `subscriptions_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `subscriptions` ADD CONSTRAINT `subscriptions_plan_id_fkey` FOREIGN KEY (`plan_id`) REFERENCES `plans`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `licenses` ADD CONSTRAINT `licenses_subscription_id_fkey` FOREIGN KEY (`subscription_id`) REFERENCES `subscriptions`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `activation_codes` ADD CONSTRAINT `activation_codes_subscription_id_fkey` FOREIGN KEY (`subscription_id`) REFERENCES `subscriptions`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `activation_codes` ADD CONSTRAINT `activation_codes_customer_id_fkey` FOREIGN KEY (`customer_id`) REFERENCES `customers`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `manual_payments` ADD CONSTRAINT `manual_payments_customer_id_fkey` FOREIGN KEY (`customer_id`) REFERENCES `customers`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `manual_payments` ADD CONSTRAINT `manual_payments_subscription_id_fkey` FOREIGN KEY (`subscription_id`) REFERENCES `subscriptions`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `manual_payment_events` ADD CONSTRAINT `manual_payment_events_payment_id_fkey` FOREIGN KEY (`payment_id`) REFERENCES `manual_payments`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `payment_evidence` ADD CONSTRAINT `payment_evidence_payment_id_fkey` FOREIGN KEY (`payment_id`) REFERENCES `manual_payments`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `subscription_events` ADD CONSTRAINT `subscription_events_subscription_id_fkey` FOREIGN KEY (`subscription_id`) REFERENCES `subscriptions`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `departments` ADD CONSTRAINT `departments_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `branches` ADD CONSTRAINT `branches_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `positions` ADD CONSTRAINT `positions_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `positions` ADD CONSTRAINT `positions_department_tenant_fk` FOREIGN KEY (`tenant_id`, `department_id`) REFERENCES `departments`(`tenant_id`, `id`) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE `employment_types` ADD CONSTRAINT `employment_types_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `shift_types` ADD CONSTRAINT `shift_types_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `public_holidays` ADD CONSTRAINT `public_holidays_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `pay_frequencies` ADD CONSTRAINT `pay_frequencies_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `employees` ADD CONSTRAINT `employees_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `employees` ADD CONSTRAINT `employees_department_tenant_fk` FOREIGN KEY (`tenant_id`, `department_id`) REFERENCES `departments`(`tenant_id`, `id`) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE `employees` ADD CONSTRAINT `employees_branch_tenant_fk` FOREIGN KEY (`tenant_id`, `branch_id`) REFERENCES `branches`(`tenant_id`, `id`) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE `employees` ADD CONSTRAINT `employees_position_tenant_fk` FOREIGN KEY (`tenant_id`, `position_id`) REFERENCES `positions`(`tenant_id`, `id`) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE `employees` ADD CONSTRAINT `employees_emptype_tenant_fk` FOREIGN KEY (`tenant_id`, `employment_type_id`) REFERENCES `employment_types`(`tenant_id`, `id`) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE `employees` ADD CONSTRAINT `employees_supervisor_tenant_fk` FOREIGN KEY (`tenant_id`, `supervisor_id`) REFERENCES `employees`(`tenant_id`, `id`) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE `employee_emergency_contacts` ADD CONSTRAINT `emergency_contacts_employee_fk` FOREIGN KEY (`tenant_id`, `employee_id`) REFERENCES `employees`(`tenant_id`, `id`) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE `employee_bank_accounts` ADD CONSTRAINT `bank_accounts_employee_fk` FOREIGN KEY (`tenant_id`, `employee_id`) REFERENCES `employees`(`tenant_id`, `id`) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE `employee_documents` ADD CONSTRAINT `documents_employee_fk` FOREIGN KEY (`tenant_id`, `employee_id`) REFERENCES `employees`(`tenant_id`, `id`) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE `compensation_histories` ADD CONSTRAINT `compensation_employee_fk` FOREIGN KEY (`tenant_id`, `employee_id`) REFERENCES `employees`(`tenant_id`, `id`) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE `employment_histories` ADD CONSTRAINT `employment_history_employee_fk` FOREIGN KEY (`tenant_id`, `employee_id`) REFERENCES `employees`(`tenant_id`, `id`) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE `employee_allowances` ADD CONSTRAINT `emp_allowances_employee_fk` FOREIGN KEY (`tenant_id`, `employee_id`) REFERENCES `employees`(`tenant_id`, `id`) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE `employee_allowances` ADD CONSTRAINT `emp_allowances_type_fk` FOREIGN KEY (`tenant_id`, `allowance_type_id`) REFERENCES `allowance_types`(`tenant_id`, `id`) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE `employee_deductions` ADD CONSTRAINT `emp_deductions_employee_fk` FOREIGN KEY (`tenant_id`, `employee_id`) REFERENCES `employees`(`tenant_id`, `id`) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE `employee_deductions` ADD CONSTRAINT `emp_deductions_type_fk` FOREIGN KEY (`tenant_id`, `deduction_type_id`) REFERENCES `deduction_types`(`tenant_id`, `id`) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE `leave_types` ADD CONSTRAINT `leave_types_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `leave_policies` ADD CONSTRAINT `leave_policies_type_fk` FOREIGN KEY (`tenant_id`, `leave_type_id`) REFERENCES `leave_types`(`tenant_id`, `id`) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE `leave_requests` ADD CONSTRAINT `leave_requests_employee_fk` FOREIGN KEY (`tenant_id`, `employee_id`) REFERENCES `employees`(`tenant_id`, `id`) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE `leave_requests` ADD CONSTRAINT `leave_requests_type_fk` FOREIGN KEY (`tenant_id`, `leave_type_id`) REFERENCES `leave_types`(`tenant_id`, `id`) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE `leave_approvals` ADD CONSTRAINT `leave_approvals_leave_request_id_fkey` FOREIGN KEY (`leave_request_id`) REFERENCES `leave_requests`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `leave_ledger` ADD CONSTRAINT `leave_ledger_employee_fk` FOREIGN KEY (`tenant_id`, `employee_id`) REFERENCES `employees`(`tenant_id`, `id`) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE `leave_ledger` ADD CONSTRAINT `leave_ledger_type_fk` FOREIGN KEY (`tenant_id`, `leave_type_id`) REFERENCES `leave_types`(`tenant_id`, `id`) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE `timesheets` ADD CONSTRAINT `timesheets_employee_fk` FOREIGN KEY (`tenant_id`, `employee_id`) REFERENCES `employees`(`tenant_id`, `id`) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE `timesheet_approvals` ADD CONSTRAINT `timesheet_approvals_timesheet_id_fkey` FOREIGN KEY (`timesheet_id`) REFERENCES `timesheets`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `overtime_requests` ADD CONSTRAINT `overtime_employee_fk` FOREIGN KEY (`tenant_id`, `employee_id`) REFERENCES `employees`(`tenant_id`, `id`) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE `overtime_requests` ADD CONSTRAINT `overtime_rule_fk` FOREIGN KEY (`tenant_id`, `overtime_rule_id`) REFERENCES `overtime_rules`(`tenant_id`, `id`) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE `overtime_approvals` ADD CONSTRAINT `overtime_approvals_overtime_id_fkey` FOREIGN KEY (`overtime_id`) REFERENCES `overtime_requests`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `statutory_components` ADD CONSTRAINT `statutory_components_version_fk` FOREIGN KEY (`tenant_id`, `version_id`) REFERENCES `statutory_rule_versions`(`tenant_id`, `id`) ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE `tax_thresholds` ADD CONSTRAINT `tax_thresholds_component_id_fkey` FOREIGN KEY (`component_id`) REFERENCES `statutory_components`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `payroll_runs` ADD CONSTRAINT `payroll_runs_period_fk` FOREIGN KEY (`tenant_id`, `period_id`) REFERENCES `payroll_periods`(`tenant_id`, `id`) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE `payroll_adjustments` ADD CONSTRAINT `payroll_adjustments_run_fk` FOREIGN KEY (`tenant_id`, `run_id`) REFERENCES `payroll_runs`(`tenant_id`, `id`) ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE `payroll_run_employees` ADD CONSTRAINT `payroll_run_employees_run_fk` FOREIGN KEY (`tenant_id`, `run_id`) REFERENCES `payroll_runs`(`tenant_id`, `id`) ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE `payroll_earnings` ADD CONSTRAINT `payroll_earnings_run_employee_id_fkey` FOREIGN KEY (`run_employee_id`) REFERENCES `payroll_run_employees`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `payroll_deductions` ADD CONSTRAINT `payroll_deductions_run_employee_id_fkey` FOREIGN KEY (`run_employee_id`) REFERENCES `payroll_run_employees`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `payslips` ADD CONSTRAINT `payslips_run_fk` FOREIGN KEY (`tenant_id`, `run_id`) REFERENCES `payroll_runs`(`tenant_id`, `id`) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE `payslips` ADD CONSTRAINT `payslips_run_employee_id_fkey` FOREIGN KEY (`run_employee_id`) REFERENCES `payroll_run_employees`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `payslip_access_events` ADD CONSTRAINT `payslip_access_events_payslip_id_fkey` FOREIGN KEY (`payslip_id`) REFERENCES `payslips`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `bank_export_batches` ADD CONSTRAINT `bank_exports_run_fk` FOREIGN KEY (`tenant_id`, `run_id`) REFERENCES `payroll_runs`(`tenant_id`, `id`) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE `import_rows` ADD CONSTRAINT `import_rows_batch_id_fkey` FOREIGN KEY (`batch_id`) REFERENCES `import_batches`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
