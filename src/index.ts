import dotenv from 'dotenv';
dotenv.config();

import express from 'express';
import cors from 'cors';
import { initializeDatabase } from './db/database';

import { createAgentHandler, getAgentsHandler, getNftIdByRoleIdHandler, generateAgentAddressHandler } from './controllers/addressController';
import { getSkillsHandler, addSkillHandler, getSkillByIdHandler, deleteSkillHandler } from './controllers/skillController';
import {
    deployAgentCvmHandler,
    getAvailableCvmHandler,
    getCvmPoolStatusHandler,
    maintainCvmPoolHandler,
    getAttestationHandler,
    getCvmStatsHandler,
    getCvmCompositionHandler,
    startCvmHandler,
    stopCvmHandler
} from './controllers/cvmController';
import {
    updateApiKeyHandler,
    listPhalaAccountsHandler,
    createPhalaAccountHandler
} from './controllers/adminController';
import { chatHandler } from './controllers/chatController';

// Initialize database
initializeDatabase().catch(err => {
    console.error('无法初始化数据库:', err);
    process.exit(1); // 数据库连接失败时退出应用
});

const app = express();

// Add CORS middleware
app.use(cors({
    origin: '*', // For development. In production, specify your frontend domain
    methods: ['GET', 'POST', 'DELETE'],
    credentials: true,
    optionsSuccessStatus: 200
}));

app.use(express.json());

const PORT = process.env.PORT || 3000;

// Agent routes
app.post('/create-agent', createAgentHandler);
app.get('/agents', getAgentsHandler);
app.get('/agent/nft-id/:role_id', getNftIdByRoleIdHandler);
app.post('/generate-agent-address', generateAgentAddressHandler);

// Skill routes
app.get('/skills', getSkillsHandler);
app.post('/skill', addSkillHandler);
app.get('/skill/:id', getSkillByIdHandler);
app.delete('/skill/:object_id', deleteSkillHandler);

// CVM deployment routes
app.post('/deploy-cvm', deployAgentCvmHandler);
app.get('/cvm/available', getAvailableCvmHandler);
app.get('/cvm/pool-status', getCvmPoolStatusHandler);
app.post('/cvm/maintain-pool', maintainCvmPoolHandler);
app.get('/cvm/attestation/:appId', getAttestationHandler);
app.get('/cvm/stats/:appId', getCvmStatsHandler);
app.get('/cvm/composition/:appId', getCvmCompositionHandler);
app.post('/cvm/start/:appId', startCvmHandler);
app.post('/cvm/stop/:appId', stopCvmHandler);

// Admin routes
app.post('/admin/update-api-key', updateApiKeyHandler);
app.get('/admin/phala-accounts', listPhalaAccountsHandler);
app.post('/admin/phala-accounts', createPhalaAccountHandler);

// Chat route
app.post('/chat', chatHandler);

app.listen(PORT, () => {
    console.log(`服务器运行在端口 ${PORT}`);
}); 