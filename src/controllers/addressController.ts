import { Request, Response } from 'express';
import axios from 'axios';
import { getAgents, createAgent, getNftIdByRoleId, getQuery, markCvmAsInUse } from '../db/database';
import { getAvailableCvm } from '../db/database';

/**
 * Generate a new agent address from CVM pool
 * @param req Request
 * @param res Response
 */
export const generateAgentAddressHandler = async (req: Request, res: Response) => {
    try {
        // 从CVM池获取可用的CVM
        const cvm = await getAvailableCvm();
        
        if (!cvm || !cvm.app_id || !cvm.cvm_endpoint) {
            return res.status(404).json({
                success: false,
                message: '无可用CVM，请稍后再试或联系管理员部署更多CVM'
            });
        }
        
        // 获取CVM的钱包地址
        try {
            const endpoint = `${cvm.cvm_endpoint.replace(/\/+$/, '')}/wallet`;
            const response = await axios.get(endpoint);
            
            if (!response.data || !response.data.address) {
                return res.status(500).json({ 
                    success: false,
                    message: 'CVM钱包未初始化' 
                });
            }
            
            // 返回地址和app_id，但不标记为使用中（创建Agent时才标记）
            res.json({
                success: true,
                address: response.data.address,
                app_id: cvm.app_id,
                cvm_id: cvm.id
            });
            
        } catch (error) {
            console.error('Error fetching wallet address from CVM:', error);
            return res.status(500).json({ 
                success: false,
                message: '无法连接到CVM钱包服务' 
            });
        }
    } catch (error) {
        console.error('Error generating agent address:', error);
        res.status(500).json({ 
            success: false,
            message: '生成代理地址时出错' 
        });
    }
};

export const createAgentHandler = async (req: Request, res: Response) => {
    try {
        const { role_id, nft_id, address, cvm_id } = req.body;

        if (!role_id || !nft_id || !address) {
            return res.status(400).json({ error: '缺少必填字段' });
        }

        // 保存将要传递给createAgent的app_id
        let app_id: string | undefined;

        // 如果提供了cvm_id，则获取对应CVM并标记为使用中
        if (cvm_id) {
            try {
                // 查询该CVM
                const cvm = await getQuery(`
                    SELECT *
                    FROM phala_accounts
                    WHERE id = ?
                `, [cvm_id]);
                
                if (cvm && cvm.length > 0) {
                    // 获取app_id
                    app_id = cvm[0].app_id;
                    // 标记CVM为使用中
                    await markCvmAsInUse(cvm_id, address);
                    console.log(`CVM ID ${cvm_id} 已标记为使用中，关联地址: ${address}，App ID: ${app_id}`);
                }
            } catch (error) {
                console.error('Error marking CVM as in-use:', error);
                // 继续处理，不中断流程
            }
        }
        
        // 创建Agent记录，添加app_id
        const success = await createAgent(role_id, nft_id, address, app_id);
        
        if (!success) {
            return res.status(500).json({ error: '创建代理时出错' });
        }
        
        res.json({
            success: true,
            message: '代理创建成功',
            agent: {
                role_id,
                nft_id,
                address,
                app_id
            }
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