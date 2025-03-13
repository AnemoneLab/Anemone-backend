import { Request, Response } from 'express';
import axios from 'axios';
import { getAgents, createAgent, getNftIdByRoleId } from '../db/database';
import { getAvailableCvm } from '../db/database';

export const createAgentHandler = async (req: Request, res: Response) => {
    try {
        const { role_id, nft_id } = req.body;

        if (!role_id || !nft_id) {
            return res.status(400).json({ error: '缺少必填字段' });
        }

        // 从CVM池获取可用的CVM
        const cvm = await getAvailableCvm();
        
        if (!cvm || !cvm.app_id || !cvm.cvm_endpoint) {
            return res.status(400).json({
                success: false,
                message: '无可用CVM'
            });
        }
        
        // 获取CVM的钱包地址
        try {
            const endpoint = `${cvm.cvm_endpoint.replace(/\/+$/, '')}/wallet`;
            const response = await axios.get(endpoint);
            
            if (!response.data || !response.data.address) {
                return res.status(500).json({ 
                    error: 'CVM钱包未初始化' 
                });
            }
            
            const address = response.data.address;
            
            // 创建Agent记录
            const success = await createAgent(role_id, nft_id, address);
            
            if (!success) {
                return res.status(500).json({ error: '创建代理时出错' });
            }
            
            // 更新CVM状态为使用中
            // 这个操作已经在getAvailableCvmHandler中完成
            
            res.json({
                success: true,
                message: '代理创建成功',
                agent: {
                    role_id,
                    nft_id,
                    address,
                    cvm_id: cvm.id,
                    app_id: cvm.app_id,
                    endpoint: cvm.cvm_endpoint
                }
            });
            
        } catch (error) {
            console.error('Error fetching wallet address from CVM:', error);
            return res.status(500).json({ 
                error: '无法连接到CVM钱包服务' 
            });
        }
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