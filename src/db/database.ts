import sqlite3 from 'sqlite3';
import { Database } from 'sqlite3';

let db: Database;

// Initialize database
export const initializeDatabase = async () => {
    db = new sqlite3.Database('./database.sqlite', (err) => {
        if (err) {
            console.error('Error opening database:', err);
            return;
        }
        console.log('Connected to SQLite database');
    });

    // Create tables if they don't exist
    await createTables();
};

// Create necessary tables
const createTables = async () => {
    const createAgentTable = `
        CREATE TABLE IF NOT EXISTS agent (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            role_id TEXT,
            nft_id TEXT,
            address TEXT NOT NULL,
            private_key TEXT NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `;

    const createSkillTable = `
        CREATE TABLE IF NOT EXISTS skill (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            object_id TEXT NOT NULL UNIQUE,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `;

    db.run(createAgentTable);
    db.run(createSkillTable);
};

// Helper function to run queries with promises
const runQuery = (query: string, params: any[] = []): Promise<any> => {
    return new Promise((resolve, reject) => {
        db.run(query, params, function(err) {
            if (err) reject(err);
            else resolve(this);
        });
    });
};

// Helper function to get results with promises
export const getQuery = (query: string, params: any[] = []): Promise<any> => {
    return new Promise((resolve, reject) => {
        db.all(query, params, (err, rows) => {
            if (err) reject(err);
            else resolve(rows);
        });
    });
};

// Database interface types
type Agent = {
    id?: number;
    role_id?: string;
    nft_id?: string;
    address: string;
    private_key: string;
    created_at?: string;
};

// Skill type definition
type Skill = {
    id?: number;
    object_id: string;
    created_at?: string;
};

// Database operations
export async function getAgents(): Promise<Omit<Agent, 'private_key'>[]> {
    const query = `
        SELECT id, role_id, nft_id, address, created_at 
        FROM agent
    `;
    return await getQuery(query);
}

export async function generateAndStoreAddress(): Promise<{address: string, success: boolean}> {
    const query = `
        INSERT INTO agent (address, private_key)
        VALUES (?, ?)
    `;
    try {
        // 这里address和private_key会从controller传入
        // 仅展示插入函数结构
        return { address: '', success: false };
    } catch (error) {
        console.error('Error storing address:', error);
        return { address: '', success: false };
    }
}

export async function createAgent(role_id: string, nft_id: string, address: string): Promise<boolean> {
    const query = `
        UPDATE agent 
        SET role_id = ?, nft_id = ?
        WHERE address = ?
    `;
    try {
        await runQuery(query, [role_id, nft_id, address]);
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