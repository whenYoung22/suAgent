import { PrismaMariaDb } from "@prisma/adapter-mariadb";

import { PrismaClient } from "../generated/prisma/client.js";

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
    throw new Error("DATABASE_URL is not set");
}

function createPrismaClient(databaseUrl: string): PrismaClient {
    return new PrismaClient({
        adapter: new PrismaMariaDb(databaseUrl)
    });
}

// tsx watch 热重载时复用同一个客户端，避免重复创建连接池
const globalForPrisma = globalThis as unknown as {
    prisma?: PrismaClient;
};

export const prisma = globalForPrisma.prisma ?? createPrismaClient(connectionString);

if (process.env.NODE_ENV !== "production") {
    globalForPrisma.prisma = prisma;
}
