import { Request, Response } from 'express';
import axios from 'axios';
import { getAgentCvmEndpoint } from '../db/database';

/**
 * Handle chat messages
 * @param req - Express request object
 * @param res - Express response object
 */
export const chatHandler = async (req: Request, res: Response) => {
    try {
        // 获取请求体中的消息内容和roleId
        const { message, roleId } = req.body;
        
        // 打印接收到的消息
        console.log(`[Chat] Received message from roleId ${roleId}: ${message}`);
        
        // 尝试获取该agent对应的CVM端点
        const cvmEndpoint = await getAgentCvmEndpoint(roleId);
        
        if (cvmEndpoint) {
            try {
                // 构建完整的CVM聊天接口URL
                const chatEndpoint = `${cvmEndpoint.replace(/\/+$/, '')}/chat`;
                
                console.log(`[Chat] Forwarding message to CVM endpoint: ${chatEndpoint}`);
                
                // 转发请求到Agent CVM
                const cvmResponse = await axios.post(chatEndpoint, { 
                    message, 
                    roleId 
                }, {
                    timeout: 5000 // 设置5秒超时
                });
                
                // 如果CVM返回了正确的响应，直接返回给客户端
                if (cvmResponse.data && cvmResponse.data.success) {
                    return res.status(200).json(cvmResponse.data);
                } else {
                    throw new Error('CVM returned invalid response');
                }
            } catch (cvmError) {
                console.error('[Chat] Error communicating with CVM:', cvmError);
                // CVM通信失败，返回备用响应
                const fallbackResponse = {
                    text: `无法连接到Agent CVM (${roleId})。这是一个备用响应: "${message}"`,
                    roleId: roleId
                };
                
                return res.status(200).json({ 
                    success: true, 
                    response: fallbackResponse 
                });
            }
        } else {
            // 如果找不到对应的CVM，返回固定内容
            console.log(`[Chat] No CVM endpoint found for roleId: ${roleId}, using fallback response`);
            const response = {
                text: `我收到了你的消息: "${message}"。这是一个固定回复，因为找不到对应的Agent CVM。`,
                roleId: roleId
            };
            
            // 返回响应
            return res.status(200).json({ 
                success: true, 
                response 
            });
        }
    } catch (error) {
        console.error('[Chat] Error processing chat message:', error);
        return res.status(500).json({ 
            success: false, 
            error: 'Internal server error' 
        });
    }
} 