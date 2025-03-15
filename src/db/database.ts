import mysql from 'mysql2/promise';
import { Pool, PoolConnection } from 'mysql2/promise';
import dotenv from 'dotenv';
dotenv.config();

let pool: Pool;

// Initialize database
export const initializeDatabase = async () => {
    try {
        // 创建数据库连接池
        pool = mysql.createPool({
            host: process.env.DB_HOST || 'localhost',
            user: process.env.DB_USER || 'anemone_user',
            password: process.env.DB_PASSWORD || '',
            database: process.env.DB_NAME || 'anemone_db',
            waitForConnections: true,
            connectionLimit: Number(process.env.DB_CONNECTION_LIMIT) || 10,
            queueLimit: 0
        });

        // 测试连接
        const connection = await pool.getConnection();
        console.log('Connected to MySQL database');
        connection.release();

        // Create tables if they don't exist
        await createTables();

        // 迁移数据库：更新旧状态值
        await migrateDatabase();

        // 初始化Phala账户记录（如果表为空）
        await initializePhalaAccounts();

        // 检查并维护CVM池
        await checkAndMaintainCvmPool();
    } catch (error) {
        console.error('Error initializing database:', error);
        throw error;
    }
};

// Create necessary tables
const createTables = async () => {
    const createAgentTable = `
        CREATE TABLE IF NOT EXISTS agent (
            id INT AUTO_INCREMENT PRIMARY KEY,
            role_id VARCHAR(255),
            nft_id VARCHAR(255),
            address VARCHAR(255) NOT NULL,
            app_id VARCHAR(255),
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    `;

    const createSkillTable = `
        CREATE TABLE IF NOT EXISTS skill (
            id INT AUTO_INCREMENT PRIMARY KEY,
            object_id VARCHAR(255) NOT NULL UNIQUE,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    `;

    const createPhalaAccountsTable = `
        CREATE TABLE IF NOT EXISTS phala_accounts (
            id INT AUTO_INCREMENT PRIMARY KEY,
            username VARCHAR(255) NOT NULL UNIQUE,
            password VARCHAR(255) NOT NULL,
            api_key VARCHAR(255),
            app_id VARCHAR(255),
            cvm_endpoint VARCHAR(255),
            cvm_address VARCHAR(255),
            status VARCHAR(50) DEFAULT 'ready', 
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    `;

    await runQuery(createAgentTable);
    await runQuery(createSkillTable);
    await runQuery(createPhalaAccountsTable);
};

// 迁移数据库，处理状态值变更
const migrateDatabase = async () => {
    try {
        console.log('检查数据库状态值...');

        // 检查是否有旧状态值
        const oldStatusCount = await getQuery(`
            SELECT COUNT(*) as count
            FROM phala_accounts
            WHERE status NOT IN ('ready', 'deploying', 'deployed', 'in_use')
        `);

        if (oldStatusCount[0].count > 0) {
            console.log(`发现 ${oldStatusCount[0].count} 条记录使用旧状态值，开始迁移...`);

            // 更新not_registered和registered为ready
            await runQuery(`
                UPDATE phala_accounts
                SET status = 'ready', updated_at = CURRENT_TIMESTAMP
                WHERE status IN ('not_registered', 'registered')
            `);

            console.log('状态值迁移完成');
        } else {
            console.log('没有发现需要迁移的旧状态值');
        }

        // 检查数据库配置
        const dbStatus = await getQuery(`
            SELECT 
                COUNT(*) as total,
                SUM(CASE WHEN api_key IS NOT NULL THEN 1 ELSE 0 END) as with_key
            FROM phala_accounts
        `);

        console.log(`数据库状态: 总计账户 ${dbStatus[0].total}, 有API Key账户 ${dbStatus[0].with_key}`);

        if (dbStatus[0].with_key === 0) {
            console.log('警告: 没有配置API Key的账户，CVM部署将无法进行');
        }
    } catch (error) {
        console.error('数据库迁移过程中出错:', error);
    }
};

// 初始化Phala账户记录，为1-100的ID创建记录
const initializePhalaAccounts = async () => {
    // 检查是否已经初始化
    const count = await getQuery('SELECT COUNT(*) as count FROM phala_accounts', []);

    if (count[0].count === 0) {
        console.log('正在初始化Phala账户记录...');

        // 创建一些示例账户，但不强制关联ID与用户名
        const exampleAccounts = [
            { username: 'AnemoneAccount1', password: '!AnemoneSecure1' },
            { username: 'AnemoneAccount2', password: '!AnemoneSecure2' },
            { username: 'AnemoneAccount3', password: '!AnemoneSecure3' },
            { username: 'AnemoneAccount4', password: '!AnemoneSecure4' },
            { username: 'AnemoneAccount5', password: '!AnemoneSecure5' },
            // 添加少量示例账户，管理员可以通过接口添加更多
        ];

        try {
            // 使用MySQL的批量插入方式
            for (const account of exampleAccounts) {
                await runQuery(
                    'INSERT INTO phala_accounts (username, password, status) VALUES (?, ?, ?)',
                    [account.username, account.password, 'ready']
                );
            }
            console.log('Phala账户记录初始化完成');
        } catch (error) {
            console.error('初始化Phala账户记录时出错:', error);
        }
    } else {
        console.log('Phala账户记录已存在，跳过初始化');
    }
};

// Helper function to run queries with promises
export const runQuery = async (query: string, params: any[] = []): Promise<any> => {
    try {
        const [results] = await pool.execute(query, params);
        return results;
    } catch (error) {
        console.error('Error executing query:', query, error);
        throw error;
    }
};

// Helper function to get results with promises
export const getQuery = async (query: string, params: any[] = []): Promise<any> => {
    try {
        const [rows] = await pool.execute(query, params);
        return rows;
    } catch (error) {
        console.error('Error executing query:', query, error);
        throw error;
    }
};

// Database interface types
type Agent = {
    id?: number;
    role_id?: string;
    nft_id?: string;
    address: string;
    app_id?: string;
    created_at?: string;
};

// Skill type definition
type Skill = {
    id?: number;
    object_id: string;
    created_at?: string;
};

// Phala Account type definition
type PhalaAccount = {
    id?: number;
    username: string;
    password: string;
    api_key?: string;
    app_id?: string;
    cvm_endpoint?: string;
    cvm_address?: string;
    status: 'ready' | 'deploying' | 'deployed' | 'in_use';  // 添加deploying状态
    created_at?: string;
    updated_at?: string;
};

// Database operations for Agents
export async function getAgents(): Promise<Agent[]> {
    const query = `
        SELECT id, role_id, nft_id, address, app_id, created_at 
        FROM agent
    `;
    return await getQuery(query);
}

export async function createAgent(role_id: string, nft_id: string, address: string, app_id?: string): Promise<boolean> {
    const query = `
        INSERT INTO agent (role_id, nft_id, address, app_id)
        VALUES (?, ?, ?, ?)
    `;
    try {
        await runQuery(query, [role_id, nft_id, address, app_id]);
        return true;
    } catch (error) {
        console.error('Error creating agent:', error);
        return false;
    }
}

export async function getNftIdByRoleId(role_id: string): Promise<string | null> {
    const query = `
        SELECT nft_id
        FROM agent
        WHERE role_id = ?
        LIMIT 1
    `;
    try {
        const rows = await getQuery(query, [role_id]);
        return rows[0]?.nft_id || null;
    } catch (error) {
        console.error('Error fetching NFT ID:', error);
        return null;
    }
}

// Database operations for CVM Pool
export async function getAvailableCvm(): Promise<PhalaAccount | null> {
    // 获取一个已部署但未使用的CVM
    const query = `
        SELECT *
        FROM phala_accounts
        WHERE status = 'deployed' AND app_id IS NOT NULL
        LIMIT 1
    `;

    try {
        const rows = await getQuery(query);
        if (rows.length > 0) {
            return rows[0];
        }
        return null;
    } catch (error) {
        console.error('Error getting available CVM:', error);
        return null;
    }
}

export async function getAvailablePhalaAccount(): Promise<PhalaAccount | null> {
    // 获取一个有API Key但未部署CVM的账户
    const query = `
        SELECT *
        FROM phala_accounts
        WHERE status = 'ready' AND api_key IS NOT NULL AND app_id IS NULL
        LIMIT 1
    `;

    try {
        const rows = await getQuery(query);
        if (rows.length > 0) {
            return rows[0];
        }

        // 如果没有找到符合条件的账户，检查是否存在状态不一致的账户
        const checkQuery = `
            SELECT COUNT(*) as count
            FROM phala_accounts
            WHERE api_key IS NOT NULL AND status NOT IN ('ready', 'deploying', 'deployed', 'in_use')
        `;

        const checkResult = await getQuery(checkQuery);
        if (checkResult[0].count > 0) {
            console.log(`发现 ${checkResult[0].count} 个状态不一致的账户，尝试修复...`);

            // 更新这些账户状态为ready
            await runQuery(`
                UPDATE phala_accounts
                SET status = 'ready', updated_at = CURRENT_TIMESTAMP
                WHERE api_key IS NOT NULL AND status NOT IN ('ready', 'deploying', 'deployed', 'in_use')
            `);

            console.log(`状态修复完成，请重试操作`);
        }

        return null;
    } catch (error) {
        console.error('Error getting available Phala account:', error);
        return null;
    }
}

export async function updatePhalaAccount(id: number, updates: Partial<PhalaAccount>): Promise<boolean> {
    // 构建更新SQL
    const keys = Object.keys(updates).filter(key => key !== 'id');
    if (keys.length === 0) return true;

    const setClause = keys.map(key => `${key} = ?`).join(', ');
    const values = keys.map(key => (updates as any)[key]);

    const query = `
        UPDATE phala_accounts
        SET ${setClause}, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
    `;

    try {
        await runQuery(query, [...values, id]);
        return true;
    } catch (error) {
        console.error('Error updating Phala account:', error);
        return false;
    }
}

export async function markCvmAsInUse(id: number, address: string): Promise<boolean> {
    try {
        await updatePhalaAccount(id, {
            status: 'in_use',
            cvm_address: address
        });
        return true;
    } catch (error) {
        console.error('Error marking CVM as in use:', error);
        return false;
    }
}

export async function getCvmPoolStatus(): Promise<{
    total: number;
    ready: number;
    deploying: number;
    deployed: number;
    in_use: number;
}> {
    try {
        const counts = await getQuery(`
            SELECT 
                COUNT(*) as total,
                SUM(CASE WHEN status = 'ready' THEN 1 ELSE 0 END) as ready,
                SUM(CASE WHEN status = 'deploying' THEN 1 ELSE 0 END) as deploying,
                SUM(CASE WHEN status = 'deployed' THEN 1 ELSE 0 END) as deployed,
                SUM(CASE WHEN status = 'in_use' THEN 1 ELSE 0 END) as in_use
            FROM phala_accounts
        `);

        return counts[0];
    } catch (error) {
        console.error('Error getting CVM pool status:', error);
        return {
            total: 0,
            ready: 0,
            deploying: 0,
            deployed: 0,
            in_use: 0
        };
    }
}

// Skills database operations
export async function getSkills(): Promise<Skill[]> {
    const query = `
        SELECT id, object_id, created_at 
        FROM skill
    `;
    return await getQuery(query);
}

export async function addSkill(object_id: string): Promise<boolean> {
    const query = `
        INSERT INTO skill (object_id)
        VALUES (?)
    `;
    try {
        await runQuery(query, [object_id]);
        return true;
    } catch (error) {
        console.error('Error adding skill:', error);
        return false;
    }
}

export async function getSkillById(id: number): Promise<Skill | null> {
    const query = `
        SELECT id, object_id, created_at
        FROM skill
        WHERE id = ?
        LIMIT 1
    `;
    try {
        const rows = await getQuery(query, [id]);
        return rows[0] || null;
    } catch (error) {
        console.error('Error fetching skill:', error);
        return null;
    }
}

export async function deleteSkill(object_id: string): Promise<boolean> {
    const query = `
        DELETE FROM skill
        WHERE object_id = ?
    `;
    try {
        await runQuery(query, [object_id]);
        return true;
    } catch (error) {
        console.error('Error deleting skill:', error);
        return false;
    }
}

// 检查并维护CVM池，确保有足够的可用CVM
export async function checkAndMaintainCvmPool(): Promise<void> {
    try {
        console.log('正在检查CVM池状态...');
        const poolStatus = await getCvmPoolStatus();

        console.log(`CVM池当前状态: 总计 ${poolStatus.total}, 就绪 ${poolStatus.ready}, 部署中 ${poolStatus.deploying}, 已部署 ${poolStatus.deployed}, 使用中 ${poolStatus.in_use}`);

        // 检查已部署但未使用的CVM数量，以及正在部署的数量
        const availableCvmCount = poolStatus.deployed;
        const deployingCount = poolStatus.deploying;
        const targetCvmCount = 10; // 目标CVM数量

        if (availableCvmCount >= targetCvmCount) {
            console.log(`CVM池已有足够的CVM (${availableCvmCount}/${targetCvmCount})`);
            return;
        }

        if (deployingCount > 0) {
            console.log(`当前有 ${deployingCount} 个CVM正在部署中，将优先等待这些部署完成`);

            // 首先检查部署中的CVM状态
            await checkDeployingCvms();

            // 重新获取状态
            const updatedStatus = await getCvmPoolStatus();
            if (updatedStatus.deployed >= targetCvmCount) {
                console.log(`检查后发现已有足够的CVM (${updatedStatus.deployed}/${targetCvmCount})`);
                return;
            }
        }

        // 需要部署的CVM数量
        const cvmsToDeployCount = targetCvmCount - availableCvmCount - deployingCount;
        if (cvmsToDeployCount <= 0) {
            console.log(`考虑到部署中的CVM，当前无需部署新的CVM`);
            return;
        }

        console.log(`CVM池需要部署 ${cvmsToDeployCount} 个CVM以达到目标数量 ${targetCvmCount}`);

        // 检查有多少有API Key的可用账户
        const availableAccounts = await getQuery(`
            SELECT COUNT(*) as count
            FROM phala_accounts
            WHERE status = 'ready' AND api_key IS NOT NULL AND app_id IS NULL
        `);

        const availableAccountCount = availableAccounts[0].count;

        if (availableAccountCount === 0) {
            console.log('没有可用的Phala账户（有API Key的ready状态账户）来部署CVM，请先添加账户或API Key');
            return;
        }

        const canDeployCount = Math.min(availableAccountCount, cvmsToDeployCount);
        console.log(`将尝试部署 ${canDeployCount} 个CVM (可用账户: ${availableAccountCount}, 需要部署: ${cvmsToDeployCount})`);

        console.log('自动部署任务已启动，后台处理中...');

        // 此处不等待部署完成，让它在后台运行
        deployNewCvms(canDeployCount).catch(error => {
            console.error('自动部署CVM过程中发生错误:', error);
        });

    } catch (error) {
        console.error('检查和维护CVM池时出错:', error);
    }
}

// 检查部署中的CVM状态
async function checkDeployingCvms(): Promise<void> {
    try {
        // 获取所有部署中的CVM
        const deployingCvms = await getQuery(`
            SELECT id, app_id, api_key
            FROM phala_accounts
            WHERE status = 'deploying' AND app_id IS NOT NULL
        `);

        if (deployingCvms.length === 0) {
            return;
        }

        console.log(`正在检查 ${deployingCvms.length} 个部署中的CVM状态...`);

        const { PhalaCloud } = require('@anemonelab/phala-cloud-sdk');
        const axios = require('axios');

        for (const cvm of deployingCvms) {
            try {
                if (!cvm.api_key || !cvm.app_id) {
                    console.log(`账户ID ${cvm.id} 缺少API Key或App ID，跳过检查`);
                    continue;
                }

                const phalaCloud = new PhalaCloud({
                    apiKey: cvm.api_key
                });

                console.log(`检查CVM状态: ${cvm.app_id} (账户ID: ${cvm.id})`);

                // 使用SDK检查CVM状态
                const status = await phalaCloud.getCvmStatus(cvm.app_id);

                if (status && status.state === 'RUNNING') {
                    console.log(`CVM ${cvm.app_id} 已成功部署完成`);

                    // 获取CVM网络信息以获取endpoint
                    try {
                        const networkInfo = await phalaCloud.getCvmNetwork(cvm.app_id);
                        console.log(`CVM ${cvm.app_id} 网络信息:`, networkInfo);

                        if (networkInfo && networkInfo.is_online && networkInfo.public_urls && networkInfo.public_urls.length > 0) {
                            // 获取公共URL作为endpoint
                            const endpoint = networkInfo.public_urls[0].app;
                            console.log(`CVM ${cvm.app_id} 已获取endpoint: ${endpoint}`);

                            // 尝试获取CVM钱包地址
                            try {
                                console.log(`正在从CVM获取钱包地址: ${endpoint}/wallet`);
                                const walletResponse = await axios.get(`${endpoint}/wallet`, { timeout: 10000 });

                                if (walletResponse.status === 200 && walletResponse.data && walletResponse.data.success && walletResponse.data.address) {
                                    const cvmAddress = walletResponse.data.address;
                                    console.log(`已获取CVM钱包地址: ${cvmAddress}`);

                                    // 更新状态为已部署，并保存endpoint和钱包地址
                                    await updatePhalaAccount(cvm.id as number, {
                                        status: 'deployed',
                                        cvm_endpoint: endpoint,
                                        cvm_address: cvmAddress
                                    });
                                    console.log(`CVM ${cvm.app_id} 状态已更新为deployed，endpoint和地址已保存`);
                                } else {
                                    console.log(`获取CVM钱包地址失败，返回数据格式不符合预期:`, walletResponse.data);
                                    // 即使没有获取到钱包地址，也将其标记为已部署
                                    await updatePhalaAccount(cvm.id as number, {
                                        status: 'deployed',
                                        cvm_endpoint: endpoint
                                    });
                                }
                            } catch (walletError: any) {
                                console.error(`获取CVM钱包地址时出错:`, walletError.message);
                                // 即使没有获取到钱包地址，也将其标记为已部署
                                await updatePhalaAccount(cvm.id as number, {
                                    status: 'deployed',
                                    cvm_endpoint: endpoint
                                });
                            }
                        } else {
                            console.log(`CVM ${cvm.app_id} 网络信息不完整或不在线，仅更新状态`);
                            // 即使没有获取到完整信息，也将其标记为已部署
                            await updatePhalaAccount(cvm.id as number, {
                                status: 'deployed'
                            });
                        }
                    } catch (netError: any) {
                        console.error(`获取CVM ${cvm.app_id} 网络信息时出错:`, netError.message);
                        // 获取网络信息失败，但部署已完成，将其标记为已部署
                        await updatePhalaAccount(cvm.id as number, {
                            status: 'deployed'
                        });
                    }
                } else if (status && ['FAILED', 'STOPPED'].includes(status.state)) {
                    console.log(`CVM ${cvm.app_id} 部署失败或已停止，状态: ${status.state}`);

                    // 重置状态为ready以便重新部署
                    await updatePhalaAccount(cvm.id as number, {
                        status: 'ready',
                        app_id: undefined
                    });
                    console.log(`CVM ${cvm.app_id} 状态已重置为ready`);
                } else {
                    console.log(`CVM ${cvm.app_id} 仍在部署中，状态: ${status ? status.state : '未知'}`);
                }

            } catch (error: any) {
                console.error(`检查CVM ${cvm.app_id} 状态时发生错误:`, error);
            }
        }
    } catch (error: any) {
        console.error('检查部署中的CVM状态时发生错误:', error);
    }
}

// 部署指定数量的CVM，后台运行
export async function deployNewCvms(count: number): Promise<void> {
    try {
        for (let i = 0; i < count; i++) {
            try {
                // 获取可用的Phala账户
                const phalaAccount = await getAvailablePhalaAccount();

                if (!phalaAccount || !phalaAccount.api_key) {
                    console.log('部署过程中没有更多可用账户，已停止部署');
                    break;
                }

                // 使用绝对路径找到docker-compose文件
                const fs = require('fs');
                const path = require('path');
                const composePath = path.resolve(__dirname, '../docker-compose/agent-cvm.yml');

                if (!fs.existsSync(composePath)) {
                    console.error(`Docker compose文件不存在: ${composePath}`);
                    break;
                }

                const { PhalaCloud } = require('@anemonelab/phala-cloud-sdk');

                // 初始化Phala Cloud SDK
                const phalaCloud = new PhalaCloud({
                    apiKey: phalaAccount.api_key
                });

                // 生成唯一的CVM名称
                const timestamp = Date.now();
                const randomString = Math.random().toString(36).substring(2, 8);
                const name = `agent-cvm-${timestamp}-${randomString}`;

                console.log(`正在部署CVM #${i + 1}: ${name} (账户ID: ${phalaAccount.id})`);

                // 部署CVM容器
                const deployResult = await phalaCloud.deploy({
                    type: 'phala',
                    mode: 'docker-compose',
                    name,
                    compose: composePath,
                    env: [
                        'NODE_ENV=production',
                        'PORT=3001'
                    ]
                });

                // 更新账户信息，标记为部署中而不是直接标记为已部署
                await updatePhalaAccount(phalaAccount.id as number, {
                    app_id: deployResult.app_id,
                    status: 'deploying'  // 使用部署中状态
                });

                console.log(`CVM #${i + 1} 部署请求已发送: ${deployResult.app_id}`);

                // 启动异步监控任务
                monitorDeployment(phalaAccount.id as number, deployResult.app_id, phalaAccount.api_key);

            } catch (error) {
                console.error(`部署CVM #${i + 1} 失败:`, error);
                // 继续尝试下一个，不中断整个过程
            }
        }

        console.log('CVM部署请求任务完成，部署过程将在后台继续');

    } catch (error) {
        console.error('部署CVM过程中发生错误:', error);
    }
}

// 异步监控单个CVM的部署状态
export async function monitorDeployment(accountId: number, appId: string, apiKey: string): Promise<void> {
    try {
        const { PhalaCloud } = require('@anemonelab/phala-cloud-sdk');
        const axios = require('axios');

        // 初始化Phala Cloud SDK
        const phalaCloud = new PhalaCloud({
            apiKey: apiKey
        });

        console.log(`开始监控部署: ${appId} (账户ID: ${accountId})`);

        // 使用SDK的监控函数
        await phalaCloud.monitorDeploymentStatus(appId, {
            interval: 10000,         // 每10秒检查一次
            maxRetries: 36,          // 最多检查36次（约6分钟）
            onStatusChange: (status: any) => {
                console.log(`CVM ${appId} 状态变化: ${status}`);
            },
            onSuccess: async () => {
                console.log(`CVM ${appId} 部署成功`);

                // 获取CVM网络信息以获取endpoint
                try {
                    const networkInfo = await phalaCloud.getCvmNetwork(appId);
                    console.log(`CVM ${appId} 网络信息:`, networkInfo);

                    if (networkInfo && networkInfo.is_online && networkInfo.public_urls && networkInfo.public_urls.length > 0) {
                        // 获取公共URL作为endpoint
                        const endpoint = networkInfo.public_urls[0].app;
                        console.log(`CVM ${appId} 已获取endpoint: ${endpoint}`);

                        // 尝试获取CVM钱包地址
                        try {
                            // 延迟一段时间，确保CVM服务已完全启动
                            await new Promise(resolve => setTimeout(resolve, 5000));

                            console.log(`正在从CVM获取钱包地址: ${endpoint}/wallet`);
                            const walletResponse = await axios.get(`${endpoint}/wallet`, { timeout: 10000 });

                            if (walletResponse.status === 200 && walletResponse.data && walletResponse.data.success && walletResponse.data.address) {
                                const cvmAddress = walletResponse.data.address;
                                console.log(`已获取CVM钱包地址: ${cvmAddress}`);

                                // 更新状态为已部署，并保存endpoint和钱包地址
                                await updatePhalaAccount(accountId, {
                                    status: 'deployed',
                                    cvm_endpoint: endpoint,
                                    cvm_address: cvmAddress
                                });
                                console.log(`CVM ${appId} 状态已更新为deployed，endpoint和地址已保存`);
                            } else {
                                console.log(`获取CVM钱包地址失败，返回数据格式不符合预期:`, walletResponse.data);
                                // 即使没有获取到钱包地址，也将其标记为已部署
                                await updatePhalaAccount(accountId, {
                                    status: 'deployed',
                                    cvm_endpoint: endpoint
                                });
                            }
                        } catch (walletError: any) {
                            console.error(`获取CVM钱包地址时出错:`, walletError.message);
                            // 即使没有获取到钱包地址，也将其标记为已部署
                            await updatePhalaAccount(accountId, {
                                status: 'deployed',
                                cvm_endpoint: endpoint
                            });
                        }
                    } else {
                        console.log(`CVM ${appId} 网络信息不完整或不在线，稍后再尝试获取endpoint`);
                        // 即使没有获取到完整信息，也将其标记为已部署
                        await updatePhalaAccount(accountId, {
                            status: 'deployed'
                        });
                    }
                } catch (error: any) {
                    console.error(`获取CVM ${appId} 网络信息时出错:`, error.message);
                    // 获取网络信息失败，但部署已完成，将其标记为已部署
                    await updatePhalaAccount(accountId, {
                        status: 'deployed'
                    });
                }
            },
            onFailure: async () => {
                console.log(`CVM ${appId} 部署失败`);
                // 重置状态
                await updatePhalaAccount(accountId, {
                    status: 'ready',
                    app_id: undefined
                });
            },
            onTimeout: async () => {
                console.log(`CVM ${appId} 部署超时`);
                // 检查当前状态
                try {
                    const status = await phalaCloud.getCvmStatus(appId);
                    if (status && status.state === 'RUNNING') {
                        console.log(`尽管监控超时，但CVM ${appId} 状态为RUNNING，将标记为已部署`);

                        // 尝试获取CVM网络信息
                        try {
                            const networkInfo = await phalaCloud.getCvmNetwork(appId);
                            if (networkInfo && networkInfo.is_online && networkInfo.public_urls && networkInfo.public_urls.length > 0) {
                                const endpoint = networkInfo.public_urls[0].app;
                                console.log(`CVM ${appId} 已获取endpoint: ${endpoint}`);

                                // 尝试获取CVM钱包地址
                                try {
                                    // 延迟一段时间，确保CVM服务已完全启动
                                    await new Promise(resolve => setTimeout(resolve, 5000));

                                    console.log(`正在从CVM获取钱包地址: ${endpoint}/wallet`);
                                    const walletResponse = await axios.get(`${endpoint}/wallet`, { timeout: 10000 });

                                    if (walletResponse.status === 200 && walletResponse.data && walletResponse.data.success && walletResponse.data.address) {
                                        const cvmAddress = walletResponse.data.address;
                                        console.log(`已获取CVM钱包地址: ${cvmAddress}`);

                                        await updatePhalaAccount(accountId, {
                                            status: 'deployed',
                                            cvm_endpoint: endpoint,
                                            cvm_address: cvmAddress
                                        });
                                        console.log(`CVM ${appId} 状态已更新为deployed，endpoint和地址已保存`);
                                    } else {
                                        console.log(`获取CVM钱包地址失败，返回数据格式不符合预期:`, walletResponse.data);
                                        await updatePhalaAccount(accountId, {
                                            status: 'deployed',
                                            cvm_endpoint: endpoint
                                        });
                                    }
                                } catch (walletError: any) {
                                    console.error(`获取CVM钱包地址时出错:`, walletError.message);
                                    await updatePhalaAccount(accountId, {
                                        status: 'deployed',
                                        cvm_endpoint: endpoint
                                    });
                                }
                            } else {
                                await updatePhalaAccount(accountId, {
                                    status: 'deployed'
                                });
                            }
                        } catch (netError: any) {
                            console.error(`尝试获取CVM ${appId} 网络信息时出错:`, netError.message);
                            await updatePhalaAccount(accountId, {
                                status: 'deployed'
                            });
                        }
                    } else {
                        console.log(`CVM ${appId} 状态为 ${status ? status.state : '未知'}，重置为ready以便重新部署`);
                        await updatePhalaAccount(accountId, {
                            status: 'ready',
                            app_id: undefined
                        });
                    }
                } catch (error: any) {
                    console.error(`检查超时的CVM ${appId} 状态时出错:`, error);
                    await updatePhalaAccount(accountId, {
                        status: 'ready',
                        app_id: undefined
                    });
                }
            }
        });
    } catch (error: any) {
        console.error(`监控CVM ${appId} 部署时发生错误:`, error);
        try {
            // 出错时重置状态
            await updatePhalaAccount(accountId, {
                status: 'ready',
                app_id: undefined
            });
        } catch (updateError: any) {
            console.error(`重置出错账户状态时发生错误:`, updateError);
        }
    }
} 