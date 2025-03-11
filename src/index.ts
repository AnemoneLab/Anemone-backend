import dotenv from 'dotenv';
dotenv.config();

import express from 'express';
import cors from 'cors';
import sqlite3 from 'sqlite3';
import { initializeDatabase } from './db/database';
import { generateAddress, createAgentHandler, getAgentsHandler, getNftIdByRoleIdHandler } from './controllers/addressController';
import { getSkillsHandler, addSkillHandler, getSkillByIdHandler, deleteSkillHandler } from './controllers/skillController';

// Initialize database
initializeDatabase().catch(console.error);

const app = express();

// 初始化数据库连接并存储在app.locals中供路由使用
const db = new sqlite3.Database('./database.sqlite', sqlite3.OPEN_READWRITE | sqlite3.OPEN_CREATE, (err) => {
    if (err) {
        console.error('Error opening database:', err);
    } else {
        console.log('Connected to SQLite database');
    }
});

app.locals.db = db;

// Add CORS middleware
app.use(cors({
    origin: '*', // For development. In production, specify your frontend domain
    methods: ['GET', 'POST'],
    credentials: true,
    optionsSuccessStatus: 200
}));

app.use(express.json());

const PORT = process.env.PORT || 3000;

// Routes
app.post('/generate-address', generateAddress);
app.post('/create-agent', createAgentHandler);
app.get('/agents', getAgentsHandler);
app.get('/agent/nft-id/:role_id', getNftIdByRoleIdHandler);

// Skill routes
app.get('/skills', getSkillsHandler);
app.post('/skill', addSkillHandler);
app.get('/skill/:id', getSkillByIdHandler);
app.delete('/skill/:object_id', deleteSkillHandler);

app.listen(PORT, () => {
    console.log(`服务器运行在端口 ${PORT}`);
}); 