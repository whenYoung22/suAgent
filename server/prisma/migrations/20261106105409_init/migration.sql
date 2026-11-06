-- CreateTable
CREATE TABLE `Session` (
    `id` CHAR(36) NOT NULL,
    `title` VARCHAR(120) NOT NULL DEFAULT '新会话',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `lastActivityAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `lastRunSequence` INTEGER NOT NULL DEFAULT 0,

    INDEX `Session_lastActivityAt_idx`(`lastActivityAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `AgentRun` (
    `id` CHAR(36) NOT NULL,
    `sessionId` CHAR(36) NOT NULL,
    `sequence` INTEGER NOT NULL,
    `status` ENUM('running', 'completed', 'interrupted', 'failed') NOT NULL DEFAULT 'running',
    `scenario` VARCHAR(64) NOT NULL,
    `startedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `finishedAt` DATETIME(3) NULL,
    `errorCode` VARCHAR(64) NULL,
    `errorMessage` TEXT NULL,

    UNIQUE INDEX `AgentRun_sessionId_sequence_key`(`sessionId`, `sequence`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Message` (
    `id` CHAR(36) NOT NULL,
    `runId` CHAR(36) NOT NULL,
    `role` ENUM('user', 'agent') NOT NULL,
    `content` LONGTEXT NOT NULL,
    `thinking` LONGTEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `Message_runId_role_key`(`runId`, `role`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ToolCall` (
    `id` CHAR(36) NOT NULL,
    `runId` CHAR(36) NOT NULL,
    `toolCallId` VARCHAR(128) NOT NULL,
    `sequence` INTEGER NOT NULL,
    `toolName` VARCHAR(128) NOT NULL,
    `status` ENUM('running', 'succeeded', 'failed') NOT NULL DEFAULT 'running',
    `arguments` JSON NOT NULL,
    `result` JSON NULL,
    `errorMessage` TEXT NULL,
    `startedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `finishedAt` DATETIME(3) NULL,

    UNIQUE INDEX `ToolCall_runId_toolCallId_key`(`runId`, `toolCallId`),
    UNIQUE INDEX `ToolCall_runId_sequence_key`(`runId`, `sequence`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `AgentRun` ADD CONSTRAINT `AgentRun_sessionId_fkey` FOREIGN KEY (`sessionId`) REFERENCES `Session`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Message` ADD CONSTRAINT `Message_runId_fkey` FOREIGN KEY (`runId`) REFERENCES `AgentRun`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ToolCall` ADD CONSTRAINT `ToolCall_runId_fkey` FOREIGN KEY (`runId`) REFERENCES `AgentRun`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
