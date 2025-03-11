import { Request, Response } from 'express';
import { Ed25519Keypair } from '@mysten/sui.js/keypairs/ed25519';
import { getAgents, createAgent, getNftIdByRoleId } from '../db/database';

export const generateAddress = async (req: Request, res: Response) => {
    try {
        // 生成新的SUI地址
        const keypair = new Ed25519Keypair();
        const address = keypair.getPublicKey().toSuiAddress();
        const privateKey = keypair.getSecretKey();
        
        // 存储地址和私钥到数据库
        const query = `
            INSERT INTO agent (address, private_key)
            VALUES (?, ?)
        `;
        
        try {
            const db = req.app.locals.db;
            db.run(query, [address, privateKey], function(err: any) {
                if (err) {
                    console.error('Error storing address:', err);
                    return res.status(500).json({ error: '存储地址时出错' });
                }
                
                res.json({
                    success: true,
                    address: address
                });
            });
        } catch (error) {
            console.error('Error executing query:', error);
            return res.status(500).json({ error: '数据库操作错误' });
        }
    } catch (error) {
        console.error('Error in generateAddress:', error);
        res.status(500).json({ error: '生成地址时出错' });
    }
};

export const createAgentHandler = async (req: Request, res: Response) => {
    try {
        const { role_id, nft_id, address } = req.body;

        if (!role_id || !nft_id || !address) {
            return res.status(400).json({ error: '缺少必填字段' });
        }

        const success = await createAgent(role_id, nft_id, address);

        if (!success) {
            return res.status(500).json({ error: '创建代理时出错' });
        }
        
        res.json({
            success: true,
            message: '代理创建成功'
        });
    } catch (error) {
        console.error('Error creating agent:', error);
        res.status(500).json({ error: '创建代理时出错' });
    }
};

export const getAgentsHandler = async (req: Request, res: Response) => {
    try {
        const agents = await getAgents();
        res.json({
            success: true,
            agents
        });
    } catch (error) {
        console.error('Error fetching agents:', error);
        res.status(500).json({ error: '获取代理列表时出错' });
    }
};

export const getNftIdByRoleIdHandler = async (req: Request, res: Response) => {
    try {
        const { role_id } = req.params;
        
        if (!role_id) {
            return res.status(400).json({ error: '需要提供角色ID' });
        }

        const nftId = await getNftIdByRoleId(role_id);
        
        if (!nftId) {
            return res.status(404).json({ error: '未找到对应代理' });
        }

        res.json({
            success: true,
            nft_id: nftId
        });
    } catch (error) {
        console.error('Error fetching NFT ID:', error);
        res.status(500).json({ error: '获取NFT ID时出错' });
    }
}; 